#!/usr/bin/env bash
# =============================================================================
# AMDAI collector preflight checks.
#
# Verifies the host is ready to run the appliance at a given (or auto-
# detected) capacity profile: OS + vCPU/RAM/disk against the profile's
# requirements (mirrors src/lib/capacity.ts CAPACITY_PROFILES[*].requires),
# tshark/dumpcap presence and non-root capture capability, Postgres
# reachability + the timescaledb extension, free UDP flow-receiver ports
# (2055 NetFlow, 4739 IPFIX, 6343 sFlow), sysctl rmem sizing, and that the
# AMDAI console URL is reachable.
#
# Exit codes:
#   0  all checks passed (warnings may still have been printed)
#   1  one or more hard failures
#
# Usage:
#   ./preflight.sh [--profile small|medium|large|xl] [--pg-url postgresql://...]
#                   [--console-url https://console.example.com]
# =============================================================================
set -uo pipefail

PROFILE=""
PG_URL="${AMDAI_LOCAL_PG:-}"
CONSOLE_URL="${AMDAI_CONSOLE_URL:-}"
FAILURES=0
WARNINGS=0

log()  { printf '[preflight] %s\n' "$*"; }
ok()   { printf '[preflight]  OK   %s\n' "$*"; }
warn() { printf '[preflight]  WARN %s\n' "$*"; WARNINGS=$((WARNINGS + 1)); }
fail() { printf '[preflight]  FAIL %s\n' "$*" >&2; FAILURES=$((FAILURES + 1)); }

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --profile) PROFILE="${2:-}"; shift 2 ;;
      --pg-url) PG_URL="${2:-}"; shift 2 ;;
      --console-url) CONSOLE_URL="${2:-}"; shift 2 ;;
      -h|--help)
        grep '^#' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
        exit 0
        ;;
      *) log "Unknown argument '$1', ignoring."; shift ;;
    esac
  done
}

# ---- OS detection --------------------------------------------------------
detect_os() {
  case "$(uname -s)" in
    Linux) echo linux ;;
    Darwin) echo macos ;;
    *) echo unknown ;;
  esac
}

detect_vcpu() {
  case "$(detect_os)" in
    linux) nproc --all 2>/dev/null || getconf _NPROCESSORS_ONLN ;;
    macos) sysctl -n hw.ncpu ;;
    *) echo 0 ;;
  esac
}

detect_ram_gb() {
  case "$(detect_os)" in
    linux) awk '/MemTotal/ { printf "%.0f", $2/1024/1024 }' /proc/meminfo ;;
    macos) awk 'BEGIN { printf "%.0f", '"$(sysctl -n hw.memsize)"' /1024/1024/1024 }' ;;
    *) echo 0 ;;
  esac
}

detect_disk_gb() {
  case "$(detect_os)" in
    linux) df -BG --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9' ;;
    macos) df -g / | tail -1 | awk '{print $4}' ;;
    *) echo 0 ;;
  esac
}

# ---- Capacity requirements, mirrors src/lib/capacity.ts ------------------
requires_vcpu()  { case "$1" in small) echo 4;;  medium) echo 8;;  large) echo 16;; xl) echo 32;;  esac; }
requires_ram()   { case "$1" in small) echo 8;;  medium) echo 32;; large) echo 64;; xl) echo 128;; esac; }
requires_disk()  { case "$1" in small) echo 100;; medium) echo 1000;; large) echo 2000;; xl) echo 4000;; esac; }

pick_profile_if_unset() {
  [ -n "${PROFILE}" ] && return 0
  local vcpu ram disk
  vcpu="$(detect_vcpu)"; ram="$(detect_ram_gb)"; disk="$(detect_disk_gb)"
  if   [ "${vcpu}" -ge 32 ] && [ "${ram}" -ge 115 ] && [ "${disk}" -ge 3600 ]; then PROFILE=xl
  elif [ "${vcpu}" -ge 16 ] && [ "${ram}" -ge 58 ]  && [ "${disk}" -ge 1800 ]; then PROFILE=large
  elif [ "${vcpu}" -ge 8 ]  && [ "${ram}" -ge 29 ]  && [ "${disk}" -ge 900 ];  then PROFILE=medium
  else PROFILE=small
  fi
  log "No --profile given; auto-detected '${PROFILE}' from host resources."
}

check_os() {
  local os
  os="$(detect_os)"
  case "${os}" in
    linux) ok "Operating system: Linux ($(uname -r))" ;;
    macos) ok "Operating system: macOS ($(sw_vers -productVersion 2>/dev/null || echo unknown))"
           case "${PROFILE}" in
             large|xl) warn "macOS is not the recommended platform for the '${PROFILE}' profile; sustained line-rate capture is better served by Linux." ;;
           esac
           ;;
    *) fail "Unsupported/unknown operating system: $(uname -s)" ;;
  esac
}

check_resources() {
  local vcpu ram disk req_vcpu req_ram req_disk
  vcpu="$(detect_vcpu)"; ram="$(detect_ram_gb)"; disk="$(detect_disk_gb)"
  req_vcpu="$(requires_vcpu "${PROFILE}")"
  req_ram="$(requires_ram "${PROFILE}")"
  req_disk="$(requires_disk "${PROFILE}")"

  log "Profile '${PROFILE}' requires >= ${req_vcpu} vCPU / ${req_ram} GB RAM / ${req_disk} GB disk."
  log "Detected: ${vcpu} vCPU / ${ram} GB RAM / ${disk} GB free disk."

  if [ "${vcpu}" -ge "${req_vcpu}" ]; then ok "vCPU count (${vcpu} >= ${req_vcpu})"
  else fail "vCPU count ${vcpu} is below the ${req_vcpu} required for profile '${PROFILE}'."; fi

  # 10% tolerance, matching recommendProfile() in capacity.ts.
  local ram_min=$(( req_ram * 9 / 10 ))
  if [ "${ram}" -ge "${ram_min}" ]; then ok "RAM (${ram} GB >= ${ram_min} GB, 90% of ${req_ram} GB)"
  else fail "RAM ${ram} GB is below the ${ram_min} GB (90% of ${req_ram} GB) required for profile '${PROFILE}'."; fi

  local disk_min=$(( req_disk * 9 / 10 ))
  if [ "${disk}" -ge "${disk_min}" ]; then ok "Free disk (${disk} GB >= ${disk_min} GB, 90% of ${req_disk} GB)"
  else fail "Free disk ${disk} GB is below the ${disk_min} GB (90% of ${req_disk} GB) required for profile '${PROFILE}'."; fi
}

check_capture_tools() {
  local tshark_bin dumpcap_bin
  tshark_bin="$(command -v tshark || true)"
  dumpcap_bin="$(command -v dumpcap || true)"

  if [ -z "${tshark_bin}" ]; then
    fail "tshark not found on PATH. Install Wireshark/tshark."
  else
    ok "tshark found at ${tshark_bin} ($(tshark -v 2>/dev/null | head -1))"
  fi

  if [ -z "${dumpcap_bin}" ]; then
    fail "dumpcap not found on PATH. Install Wireshark/tshark (provides dumpcap)."
    return 0
  fi
  ok "dumpcap found at ${dumpcap_bin}"

  case "$(detect_os)" in
    linux)
      if command -v getcap >/dev/null 2>&1 && getcap "${dumpcap_bin}" 2>/dev/null | grep -q cap_net_raw; then
        ok "dumpcap has cap_net_raw/cap_net_admin; non-root capture should work."
      elif [ "$(id -u)" -eq 0 ]; then
        warn "Running as root; capture will work but the service should run as a non-root user with capabilities granted (see install-linux.sh grant_dumpcap_capability)."
      else
        fail "dumpcap lacks cap_net_raw/cap_net_admin and we are not root. Run: sudo setcap cap_net_raw,cap_net_admin=eip $(command -v dumpcap)"
      fi
      ;;
    macos)
      if [ -e /dev/bpf0 ]; then
        local bpf_perms
        bpf_perms="$(stat -f '%Sp %Sg' /dev/bpf0 2>/dev/null)"
        if dscl . -read /Groups/access_bpf >/dev/null 2>&1 && groups "$(whoami)" 2>/dev/null | grep -q access_bpf; then
          ok "ChmodBPF/access_bpf configured for non-root capture (/dev/bpf0: ${bpf_perms})."
        else
          warn "access_bpf group not found or current user not a member; capture may require root. Run install-macos.sh's ChmodBPF step."
        fi
      else
        warn "/dev/bpf0 not found; capture devices may be created on demand."
      fi
      ;;
  esac
}

check_postgres() {
  if [ -z "${PG_URL}" ]; then
    warn "No Postgres URL provided (--pg-url or AMDAI_LOCAL_PG); skipping database checks."
    return 0
  fi
  if ! command -v psql >/dev/null 2>&1; then
    warn "psql client not found; cannot verify Postgres reachability/TimescaleDB. Install postgresql-client."
    return 0
  fi
  if psql "${PG_URL}" -v ON_ERROR_STOP=1 -Atc "SELECT 1;" >/dev/null 2>&1; then
    ok "Postgres reachable at the configured URL."
  else
    fail "Could not connect to Postgres using the configured URL."
    return 0
  fi
  local ts_installed
  ts_installed="$(psql "${PG_URL}" -Atc "SELECT 1 FROM pg_extension WHERE extname = 'timescaledb';" 2>/dev/null)"
  if [ "${ts_installed}" = "1" ]; then
    ok "TimescaleDB extension is installed in the target database."
  else
    fail "TimescaleDB extension not found. Run: CREATE EXTENSION IF NOT EXISTS timescaledb;"
  fi
}

check_udp_ports() {
  local ports=(2055 4739 6343)
  for port in "${ports[@]}"; do
    local in_use=""
    if command -v ss >/dev/null 2>&1; then
      ss -uln 2>/dev/null | awk '{print $5}' | grep -qE "[.:]${port}\$" && in_use=1
    elif command -v lsof >/dev/null 2>&1; then
      lsof -nP -iUDP:"${port}" >/dev/null 2>&1 && in_use=1
    else
      warn "Neither 'ss' nor 'lsof' available; cannot verify UDP port ${port} is free."
      continue
    fi
    if [ -n "${in_use}" ]; then
      fail "UDP port ${port} is already in use; the matching flow receiver will fail to bind."
    else
      ok "UDP port ${port} is free."
    fi
  done
}

check_sysctl() {
  case "$(detect_os)" in
    linux)
      local rmem_max
      rmem_max="$(sysctl -n net.core.rmem_max 2>/dev/null || echo 0)"
      local min_rmem
      case "${PROFILE}" in
        small)  min_rmem=8388608 ;;
        medium) min_rmem=33554432 ;;
        large)  min_rmem=67108864 ;;
        xl)     min_rmem=134217728 ;;
        *)      min_rmem=8388608 ;;
      esac
      if [ "${rmem_max}" -ge "${min_rmem}" ]; then
        ok "net.core.rmem_max (${rmem_max}) meets the ${min_rmem} recommended for profile '${PROFILE}'."
      else
        warn "net.core.rmem_max (${rmem_max}) is below the ${min_rmem} recommended for profile '${PROFILE}'; flow receivers may drop packets under burst. See install-linux.sh apply_sysctl_tuning / /etc/sysctl.d/99-amdai.conf."
      fi
      ;;
    macos)
      local maxsockbuf
      maxsockbuf="$(sysctl -n kern.ipc.maxsockbuf 2>/dev/null || echo 0)"
      if [ "${maxsockbuf}" -ge 8388608 ]; then
        ok "kern.ipc.maxsockbuf (${maxsockbuf}) is adequate."
      else
        warn "kern.ipc.maxsockbuf (${maxsockbuf}) is low; consider raising it via sysctl for sustained flow ingestion."
      fi
      ;;
    *) warn "Skipping sysctl checks on unrecognized OS." ;;
  esac
}

check_console() {
  if [ -z "${CONSOLE_URL}" ]; then
    warn "No console URL provided (--console-url or AMDAI_CONSOLE_URL); skipping reachability check."
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    warn "curl not found; cannot verify console reachability."
    return 0
  fi
  local code
  code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 "${CONSOLE_URL%/}/healthz" 2>/dev/null || \
          curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "${CONSOLE_URL}" 2>/dev/null || echo 000)"
  if [ "${code}" != "000" ]; then
    ok "Console reachable at ${CONSOLE_URL} (HTTP ${code})."
  else
    fail "Console at ${CONSOLE_URL} is not reachable within 5s."
  fi
}

summary() {
  echo
  log "Preflight summary for profile '${PROFILE}': ${FAILURES} failure(s), ${WARNINGS} warning(s)."
  if [ "${FAILURES}" -gt 0 ]; then
    err_out="Preflight failed: resolve the FAIL items above before installing/starting the collector."
    printf '[preflight] %s\n' "${err_out}" >&2
    exit 1
  fi
  log "Preflight passed. Review any WARN items above before running at sustained load."
  exit 0
}

main() {
  parse_args "$@"
  pick_profile_if_unset
  case "${PROFILE}" in
    small|medium|large|xl) ;;
    *) fail "Invalid profile '${PROFILE}' (expected small|medium|large|xl)"; summary ;;
  esac
  check_os
  check_resources
  check_capture_tools
  check_postgres
  check_udp_ports
  check_sysctl
  check_console
  summary
}

main "$@"
