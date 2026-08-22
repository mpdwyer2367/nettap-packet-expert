#!/usr/bin/env bash
# =============================================================================
# AMDAI collector appliance installer (macOS, launchd).
#
# Idempotent: safe to re-run. Uses Homebrew to install postgresql@16,
# timescaledb, and wireshark (for tshark/dumpcap), creates the amdai
# database/role, sets up the Wireshark ChmodBPF helper so packet capture
# works without root, and installs launchd agents for the collector and web
# app. Intended for lab/branch macOS hosts (small/medium profiles); macOS is
# not recommended for large/xl line-rate capture.
#
# Usage:
#   ./install-macos.sh --profile medium \
#       --console-url https://console.example.com \
#       --token <pairing-token> [--unattended]
#
# Flags:
#   --profile <small|medium|large|xl>   Force a profile (default: auto-detect)
#   --console-url <url>                 AMDAI_CONSOLE_URL for the collector
#   --token <token>                     AMDAI_COLLECTOR_TOKEN pairing token
#   --unattended                        Never prompt; fail instead of asking
#
# Notes:
#   - Run as your normal admin user (NOT sudo/root); Homebrew and launchd
#     user agents expect this. The script uses sudo internally only for the
#     ChmodBPF install and launchd LaunchDaemon steps that require root.
#   - Requires Xcode Command Line Tools (`xcode-select --install`) for
#     Homebrew if not already present.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
AMDAI_HOME="${HOME}/Library/Application Support/AMDAI"
AMDAI_COLLECTOR_HOME="${AMDAI_HOME}/collector"
AMDAI_APP_HOME="${AMDAI_HOME}/app"
AMDAI_DB="amdai_collector"
AMDAI_DB_USER="amdai"
LAUNCHD_DIR="${HOME}/Library/LaunchAgents"
CHMODBPF_PLIST="/Library/LaunchDaemons/org.wireshark.ChmodBPF.plist"

PROFILE=""
CONSOLE_URL=""
TOKEN=""
UNATTENDED=0

log()  { printf '[amdai-install] %s\n' "$*"; }
err()  { printf '[amdai-install][ERROR] %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

require_not_root() {
  if [ "$(id -u)" -eq 0 ]; then
    die "Run this installer as your normal admin user, not root/sudo."
  fi
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --profile) PROFILE="${2:-}"; shift 2 ;;
      --console-url) CONSOLE_URL="${2:-}"; shift 2 ;;
      --token) TOKEN="${2:-}"; shift 2 ;;
      --unattended) UNATTENDED=1; shift ;;
      -h|--help)
        grep '^#' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
        exit 0
        ;;
      *) die "Unknown argument: $1" ;;
    esac
  done
}

confirm_or_die() {
  local prompt="$1"
  if [ "${UNATTENDED}" -eq 1 ]; then return 0; fi
  read -r -p "${prompt} [y/N] " reply || true
  case "${reply}" in
    y|Y|yes|YES) return 0 ;;
    *) die "Aborted by operator." ;;
  esac
}

detect_vcpu() { sysctl -n hw.ncpu; }
detect_ram_gb() { awk 'BEGIN { printf "%.0f", '"$(sysctl -n hw.memsize)"' / 1024/1024/1024 }'; }
detect_disk_gb() { df -g "${HOME}" | tail -1 | awk '{print $2}'; }

pick_profile() {
  if [ -n "${PROFILE}" ]; then
    case "${PROFILE}" in
      small|medium|large|xl) return 0 ;;
      *) die "Invalid --profile '${PROFILE}' (expected small|medium|large|xl)" ;;
    esac
  fi

  local vcpu ram disk
  vcpu="$(detect_vcpu)"
  ram="$(detect_ram_gb)"
  disk="$(detect_disk_gb)"
  log "Detected: ${vcpu} vCPU, ${ram} GB RAM, ${disk} GB disk"

  # Thresholds mirror src/lib/capacity.ts CAPACITY_PROFILES[*].requires,
  # matched from the top (richest) down, with a 10% tolerance like
  # recommendProfile() in that file. macOS is only formally supported for
  # small/medium; large/xl are allowed but flagged as unusual.
  if   [ "${vcpu}" -ge 32 ] && [ "${ram}" -ge 115 ] && [ "${disk}" -ge 3600 ]; then PROFILE=xl
  elif [ "${vcpu}" -ge 16 ] && [ "${ram}" -ge 58 ]  && [ "${disk}" -ge 1800 ]; then PROFILE=large
  elif [ "${vcpu}" -ge 8 ]  && [ "${ram}" -ge 29 ]  && [ "${disk}" -ge 900 ];  then PROFILE=medium
  else PROFILE=small
  fi
  log "Selected capacity profile: ${PROFILE}"

  case "${PROFILE}" in
    large|xl) log "WARNING: macOS is not the recommended platform for ${PROFILE}; consider Linux for sustained line-rate capture." ;;
  esac
}

ensure_homebrew() {
  if ! command -v brew >/dev/null 2>&1; then
    die "Homebrew not found. Install it from https://brew.sh and re-run."
  fi
  log "Using Homebrew at $(command -v brew)"
}

install_packages_brew() {
  log "Installing postgresql@16, timescaledb, and wireshark (tshark/dumpcap) via Homebrew."
  brew list postgresql@16 >/dev/null 2>&1 || brew install postgresql@16
  brew list timescaledb >/dev/null 2>&1 || brew install timescaledb
  brew list wireshark >/dev/null 2>&1 || brew install --cask wireshark 2>/dev/null || brew install wireshark

  # timescaledb-tune configures postgresql.conf for the detected Homebrew PG.
  if command -v timescaledb-tune >/dev/null 2>&1; then
    timescaledb-tune --quiet --yes --pg-config="$(brew --prefix postgresql@16)/bin/pg_config" || true
  fi
}

ensure_postgres_running() {
  brew services start postgresql@16 >/dev/null 2>&1 || true
  local tries=0
  until "$(brew --prefix postgresql@16)/bin/pg_isready" -q 2>/dev/null; do
    tries=$((tries + 1))
    [ "${tries}" -ge 30 ] && die "postgresql@16 did not become ready via 'brew services'."
    sleep 1
  done
}

random_password() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24; }

ensure_db_and_extension() {
  local pgpass_file="${AMDAI_HOME}/.pgpass_generated"
  local db_password
  local psql_bin="$(brew --prefix postgresql@16)/bin/psql"
  local pg_superuser
  pg_superuser="$(whoami)"

  mkdir -p "${AMDAI_HOME}"

  if [ -f "${pgpass_file}" ]; then
    db_password="$(cat "${pgpass_file}")"
  else
    db_password="$(random_password)"
  fi

  "${psql_bin}" -v ON_ERROR_STOP=1 -d postgres <<-SQL
	DO \$\$
	BEGIN
	  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${AMDAI_DB_USER}') THEN
	    CREATE ROLE ${AMDAI_DB_USER} LOGIN PASSWORD '${db_password}';
	  ELSE
	    ALTER ROLE ${AMDAI_DB_USER} WITH PASSWORD '${db_password}';
	  END IF;
	END
	\$\$;
	SELECT 'CREATE DATABASE ${AMDAI_DB} OWNER ${AMDAI_DB_USER}'
	WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${AMDAI_DB}')\gexec
	SQL
  "${psql_bin}" -v ON_ERROR_STOP=1 -d "${AMDAI_DB}" -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"

  umask 077
  printf '%s' "${db_password}" > "${pgpass_file}"
  chmod 600 "${pgpass_file}"

  AMDAI_LOCAL_PG="postgresql://${AMDAI_DB_USER}:${db_password}@127.0.0.1:5432/${AMDAI_DB}"
}

install_chmodbpf() {
  # Wireshark's Homebrew cask normally installs the ChmodBPF LaunchDaemon and
  # 'access_bpf' group already; make sure both are active and this user is a
  # member, so dumpcap can open /dev/bpf* without running as root.
  log "Ensuring the ChmodBPF LaunchDaemon is installed and this user can capture without root."

  if [ ! -f "${CHMODBPF_PLIST}" ]; then
    local wireshark_prefix
    wireshark_prefix="$(brew --prefix wireshark 2>/dev/null || true)"
    local candidate="${wireshark_prefix}/org.wireshark.ChmodBPF.plist"
    if [ -f "${candidate}" ]; then
      sudo cp "${candidate}" "${CHMODBPF_PLIST}"
    else
      log "WARNING: could not locate org.wireshark.ChmodBPF.plist; install Wireshark.app once from" \
          "https://www.wireshark.org/download.html to get the ChmodBPF helper, then re-run."
    fi
  fi

  if [ -f "${CHMODBPF_PLIST}" ]; then
    sudo chown root:wheel "${CHMODBPF_PLIST}"
    sudo launchctl bootstrap system "${CHMODBPF_PLIST}" 2>/dev/null || \
      sudo launchctl load "${CHMODBPF_PLIST}" 2>/dev/null || true
  fi

  if ! dscl . -read /Groups/access_bpf >/dev/null 2>&1; then
    log "WARNING: 'access_bpf' group not found; non-root capture may not work until Wireshark.app is installed once."
  else
    sudo dseditgroup -o edit -a "$(whoami)" -t user access_bpf
    log "Added $(whoami) to the access_bpf group (log out/in for group membership to take effect in all apps)."
  fi
}

install_node_if_missing() {
  if command -v node >/dev/null 2>&1 && [ "$(node -v | sed 's/^v//; s/\..*//')" -ge 20 ]; then
    return 0
  fi
  log "Installing Node.js 20 via Homebrew."
  brew install node@20
  brew link --overwrite --force node@20
}

build_and_stage_collector() {
  local repo_collector_dir
  repo_collector_dir="$(cd -- "${SCRIPT_DIR}/.." &>/dev/null && pwd)"
  log "Staging collector application from ${repo_collector_dir} to ${AMDAI_COLLECTOR_HOME}"
  mkdir -p "${AMDAI_COLLECTOR_HOME}" "${AMDAI_APP_HOME}" "${AMDAI_COLLECTOR_HOME}/data/spool" "${AMDAI_COLLECTOR_HOME}/config"
  rsync -a --delete --exclude node_modules --exclude data --exclude config \
    "${repo_collector_dir}/" "${AMDAI_COLLECTOR_HOME}/" 2>/dev/null || \
    cp -a "${repo_collector_dir}/." "${AMDAI_COLLECTOR_HOME}/"
  (cd "${AMDAI_COLLECTOR_HOME}" && npm ci --omit=dev || npm install --omit=dev)
  (cd "${AMDAI_COLLECTOR_HOME}" && npm run build)
}

write_env_file() {
  local env_file="${AMDAI_HOME}/collector.env"
  umask 077
  cat > "${env_file}" <<-EOF
	AMDAI_PROFILE=${PROFILE}
	AMDAI_CONSOLE_URL=${CONSOLE_URL}
	AMDAI_COLLECTOR_TOKEN=${TOKEN}
	AMDAI_LOCAL_PG=${AMDAI_LOCAL_PG}
	AMDAI_API_PORT=8787
	EOF
  chmod 600 "${env_file}"
}

write_launchd_plists() {
  mkdir -p "${LAUNCHD_DIR}"
  local node_bin
  node_bin="$(command -v node)"
  local dumpcap_bin
  dumpcap_bin="$(command -v dumpcap || true)"

  cat > "${LAUNCHD_DIR}/com.amdai.collector.plist" <<-EOF
	<?xml version="1.0" encoding="UTF-8"?>
	<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
	<plist version="1.0">
	<dict>
	  <key>Label</key><string>com.amdai.collector</string>
	  <key>ProgramArguments</key>
	  <array>
	    <string>${node_bin}</string>
	    <string>${AMDAI_COLLECTOR_HOME}/dist/index.js</string>
	  </array>
	  <key>EnvironmentVariables</key>
	  <dict>
	    <key>AMDAI_ENV_FILE</key><string>${AMDAI_HOME}/collector.env</string>
	    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
	  </dict>
	  <key>WorkingDirectory</key><string>${AMDAI_COLLECTOR_HOME}</string>
	  <key>StandardOutPath</key><string>${AMDAI_HOME}/collector.log</string>
	  <key>StandardErrorPath</key><string>${AMDAI_HOME}/collector.err.log</string>
	  <key>RunAtLoad</key><true/>
	  <key>KeepAlive</key><true/>
	</dict>
	</plist>
	EOF

  cat > "${LAUNCHD_DIR}/com.amdai.app.plist" <<-EOF
	<?xml version="1.0" encoding="UTF-8"?>
	<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
	<plist version="1.0">
	<dict>
	  <key>Label</key><string>com.amdai.app</string>
	  <key>ProgramArguments</key>
	  <array>
	    <string>${node_bin}</string>
	    <string>${AMDAI_APP_HOME}/dist/index.js</string>
	  </array>
	  <key>EnvironmentVariables</key>
	  <dict>
	    <key>AMDAI_ENV_FILE</key><string>${AMDAI_HOME}/collector.env</string>
	    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
	  </dict>
	  <key>WorkingDirectory</key><string>${AMDAI_APP_HOME}</string>
	  <key>StandardOutPath</key><string>${AMDAI_HOME}/app.log</string>
	  <key>StandardErrorPath</key><string>${AMDAI_HOME}/app.err.log</string>
	  <key>RunAtLoad</key><true/>
	  <key>KeepAlive</key><true/>
	</dict>
	</plist>
	EOF

  if [ -n "${dumpcap_bin}" ]; then
    log "dumpcap found at ${dumpcap_bin}; capture relies on ChmodBPF + access_bpf group, not setcap (unsupported on macOS)."
  fi

  launchctl bootout "gui/$(id -u)/com.amdai.collector" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)/com.amdai.app" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "${LAUNCHD_DIR}/com.amdai.collector.plist"
  launchctl bootstrap "gui/$(id -u)" "${LAUNCHD_DIR}/com.amdai.app.plist"
  launchctl enable "gui/$(id -u)/com.amdai.collector"
  launchctl enable "gui/$(id -u)/com.amdai.app"
  log "launchd agents com.amdai.collector and com.amdai.app installed and started."
}

print_pairing_instructions() {
  cat <<-EOF

	=============================================================================
	AMDAI collector installed (profile: ${PROFILE}).

	Logs:
	  ${AMDAI_HOME}/collector.log / collector.err.log
	  ${AMDAI_HOME}/app.log / app.err.log

	Manage services:
	  launchctl kickstart -k gui/$(id -u)/com.amdai.collector
	  launchctl print gui/$(id -u)/com.amdai.collector

	Pairing with the console:
	EOF
  if [ -n "${CONSOLE_URL}" ] && [ -n "${TOKEN}" ]; then
    cat <<-EOF
	  This appliance is already configured to phone home to:
	    ${CONSOLE_URL}
	  using the pairing token supplied on the command line. Open the console's
	  Collectors page — this host should appear as "pending" within a minute,
	  then click Approve to finish pairing.
	EOF
  else
    cat <<-EOF
	  No --console-url/--token were supplied. In the AMDAI console, go to
	  Collectors -> Add Collector to generate a pairing token, then edit
	  ${AMDAI_HOME}/collector.env and set:
	    AMDAI_CONSOLE_URL=https://<your-console>
	    AMDAI_COLLECTOR_TOKEN=<token from the console>
	  and restart with:
	    launchctl kickstart -k gui/$(id -u)/com.amdai.collector
	EOF
  fi
  cat <<-EOF
	=============================================================================
	EOF
}

main() {
  require_not_root
  parse_args "$@"
  ensure_homebrew
  pick_profile
  confirm_or_die "Install AMDAI collector with profile '${PROFILE}'?"
  install_packages_brew
  ensure_postgres_running
  ensure_db_and_extension
  install_chmodbpf
  install_node_if_missing
  build_and_stage_collector
  write_env_file
  write_launchd_plists
  print_pairing_instructions
}

main "$@"
