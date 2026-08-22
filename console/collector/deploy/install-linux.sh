#!/usr/bin/env bash
# =============================================================================
# AMDAI collector appliance installer (Linux, systemd).
#
# Idempotent: safe to re-run. Detects CPU/RAM/disk, picks (or accepts) a
# capacity profile, installs tshark/dumpcap + Postgres 16 + TimescaleDB,
# creates the amdai OS user/database, grants dumpcap capture capability to
# the service user without root, applies sysctl tuning, and installs+starts
# the amdai-collector.service / amdai-app.service systemd units.
#
# Usage:
#   sudo ./install-linux.sh --profile medium \
#       --console-url https://console.example.com \
#       --token <pairing-token> [--unattended]
#
# Flags:
#   --profile <small|medium|large|xl>   Force a profile (default: auto-detect)
#   --console-url <url>                 AMDAI_CONSOLE_URL for the collector
#   --token <token>                     AMDAI_COLLECTOR_TOKEN pairing token
#   --unattended                        Never prompt; fail instead of asking
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
AMDAI_HOME="/opt/amdai"
AMDAI_COLLECTOR_HOME="${AMDAI_HOME}/collector"
AMDAI_APP_HOME="${AMDAI_HOME}/app"
AMDAI_USER="amdai"
AMDAI_GROUP="amdai"
AMDAI_DB="amdai_collector"
AMDAI_DB_USER="amdai"
SYSCTL_FILE="/etc/sysctl.d/99-amdai.conf"

PROFILE=""
CONSOLE_URL=""
TOKEN=""
UNATTENDED=0

log()  { printf '[amdai-install] %s\n' "$*"; }
err()  { printf '[amdai-install][ERROR] %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "This installer must run as root (use sudo)."
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

detect_vcpu() { nproc --all 2>/dev/null || getconf _NPROCESSORS_ONLN; }

detect_ram_gb() {
  awk '/MemTotal/ { printf "%.0f", $2/1024/1024 }' /proc/meminfo
}

detect_disk_gb() {
  df -BG --output=size "${AMDAI_HOME}" 2>/dev/null | tail -1 | tr -dc '0-9' \
    || df -BG --output=size / | tail -1 | tr -dc '0-9'
}

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
  # recommendProfile() in that file.
  if   [ "${vcpu}" -ge 32 ] && [ "${ram}" -ge 115 ] && [ "${disk}" -ge 3600 ]; then PROFILE=xl
  elif [ "${vcpu}" -ge 16 ] && [ "${ram}" -ge 58 ]  && [ "${disk}" -ge 1800 ]; then PROFILE=large
  elif [ "${vcpu}" -ge 8 ]  && [ "${ram}" -ge 29 ]  && [ "${disk}" -ge 900 ];  then PROFILE=medium
  else PROFILE=small
  fi
  log "Selected capacity profile: ${PROFILE}"
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

install_packages_apt() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends \
    tshark curl ca-certificates gnupg lsb-release libcap2-bin \
    postgresql-common apt-transport-https
  # Debian/Ubuntu Postgres PGDG repo (idempotent).
  if [ ! -f /etc/apt/sources.list.d/pgdg.list ]; then
    /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
  fi
  apt-get install -y --no-install-recommends postgresql-16 postgresql-client-16
  # TimescaleDB apt repo (idempotent).
  if [ ! -f /etc/apt/sources.list.d/timescaledb.list ]; then
    echo "deb https://packagecloud.io/timescale/timescaledb/$(lsb_release -is | tr 'A-Z' 'a-z')/ $(lsb_release -cs) main" \
      > /etc/apt/sources.list.d/timescaledb.list
    curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey | gpg --dearmor -o /usr/share/keyrings/timescaledb.gpg
    apt-get update
  fi
  apt-get install -y --no-install-recommends timescaledb-2-postgresql-16 || \
    log "timescaledb-2-postgresql-16 not available; continuing (check repo/arch)."
}

install_packages_dnf() {
  dnf install -y wireshark-cli curl ca-certificates libcap dnf-plugins-core policycoreutils-python-utils || true
  if ! rpm -q pgdg-redhat-repo >/dev/null 2>&1; then
    local relver
    relver="$(rpm -E %{rhel})"
    dnf install -y "https://download.postgresql.org/pub/repos/yum/reporpms/EL-${relver}-x86_64/pgdg-redhat-repo-latest.noarch.rpm" || true
  fi
  dnf -qy module disable postgresql || true
  dnf install -y postgresql16-server postgresql16-contrib
  if [ ! -f /usr/pgsql-16/data/PG_VERSION ]; then
    /usr/pgsql-16/bin/postgresql-16-setup initdb
  fi
  # TimescaleDB yum repo (idempotent).
  if [ ! -f /etc/yum.repos.d/timescale_timescaledb.repo ]; then
    curl -fsSL https://packagecloud.io/install/repositories/timescale/timescaledb/script.rpm.sh | bash
  fi
  dnf install -y timescaledb-2-postgresql-16 || \
    log "timescaledb-2-postgresql-16 not available; continuing (check repo/arch)."
  command -v timescaledb-tune >/dev/null 2>&1 && timescaledb-tune --quiet --yes || true
}

detect_pkg_manager_and_install() {
  if command -v apt-get >/dev/null 2>&1; then
    install_packages_apt
  elif command -v dnf >/dev/null 2>&1; then
    install_packages_dnf
  else
    die "Unsupported distribution: need apt-get or dnf."
  fi
}

pg_bin_dir() {
  if [ -d /usr/lib/postgresql/16/bin ]; then echo /usr/lib/postgresql/16/bin
  elif [ -d /usr/pgsql-16/bin ]; then echo /usr/pgsql-16/bin
  else command -v pg_ctl >/dev/null 2>&1 && dirname "$(command -v pg_ctl)" || die "postgres 16 binaries not found"
  fi
}

ensure_postgres_running() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now postgresql 2>/dev/null || \
      systemctl enable --now postgresql-16 2>/dev/null || \
      systemctl enable --now postgresql@16-main 2>/dev/null || true
  fi
}

random_password() {
  tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24
}

ensure_db_and_extension() {
  local pgpass_file="${AMDAI_HOME}/.pgpass_generated"
  local db_password

  if [ -f "${pgpass_file}" ]; then
    db_password="$(cat "${pgpass_file}")"
  else
    db_password="$(random_password)"
  fi

  sudo -u postgres psql -v ON_ERROR_STOP=1 <<-SQL
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
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${AMDAI_DB}" -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"

  mkdir -p "${AMDAI_HOME}"
  umask 077
  printf '%s' "${db_password}" > "${pgpass_file}"
  chmod 600 "${pgpass_file}"

  AMDAI_LOCAL_PG="postgresql://${AMDAI_DB_USER}:${db_password}@127.0.0.1:5432/${AMDAI_DB}"
}

apply_postgres_tuning() {
  local profile_env="${SCRIPT_DIR}/profiles/${PROFILE}.env"
  [ -f "${profile_env}" ] || die "Missing profile file: ${profile_env}"
  # shellcheck disable=SC1090
  set -a; source "${profile_env}"; set +a

  local conf_dir
  if [ -d /etc/postgresql/16/main ]; then conf_dir=/etc/postgresql/16/main
  elif [ -d /var/lib/pgsql/16/data ]; then conf_dir=/var/lib/pgsql/16/data
  elif [ -d /usr/pgsql-16/data ]; then conf_dir=/usr/pgsql-16/data
  else die "Could not locate the PostgreSQL 16 config directory."
  fi

  local tuning_file="${conf_dir}/conf.d/amdai-tuning.conf"
  mkdir -p "${conf_dir}/conf.d" 2>/dev/null || true
  cat > "${tuning_file}" <<-EOF
	# Managed by amdai install-linux.sh — profile: ${PROFILE}. Safe to regenerate.
	shared_preload_libraries = 'timescaledb'
	shared_buffers = '${PG_SHARED_BUFFERS}'
	effective_cache_size = '${PG_EFFECTIVE_CACHE_SIZE}'
	work_mem = '${PG_WORK_MEM}'
	max_wal_size = '${PG_MAX_WAL_SIZE}'
	max_connections = ${PG_MAX_CONNECTIONS}
	wal_compression = ${PG_WAL_COMPRESSION}
	EOF

  if ! grep -q "conf.d/amdai-tuning.conf" "${conf_dir}/postgresql.conf" 2>/dev/null; then
    echo "include_if_exists = 'conf.d/amdai-tuning.conf'" >> "${conf_dir}/postgresql.conf"
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart postgresql 2>/dev/null || \
      systemctl restart postgresql-16 2>/dev/null || \
      systemctl restart postgresql@16-main 2>/dev/null || true
  fi
}

create_amdai_user() {
  if ! id "${AMDAI_USER}" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "${AMDAI_HOME}" --shell /usr/sbin/nologin "${AMDAI_USER}"
  fi
  mkdir -p "${AMDAI_COLLECTOR_HOME}" "${AMDAI_APP_HOME}" "${AMDAI_COLLECTOR_HOME}/data/spool" "${AMDAI_COLLECTOR_HOME}/config"
  chown -R "${AMDAI_USER}:${AMDAI_GROUP}" "${AMDAI_HOME}"
}

grant_dumpcap_capability() {
  local dumpcap_bin
  dumpcap_bin="$(command -v dumpcap || echo /usr/bin/dumpcap)"
  [ -x "${dumpcap_bin}" ] || die "dumpcap not found after package install."

  if ! getent group wireshark >/dev/null 2>&1; then
    groupadd --system wireshark
  fi
  usermod -aG wireshark "${AMDAI_USER}"

  # Grant capture capability directly to the dumpcap binary so the amdai
  # service user can capture packets without ever running as root.
  setcap cap_net_raw,cap_net_admin=eip "${dumpcap_bin}"
  chgrp wireshark "${dumpcap_bin}"
  chmod 750 "${dumpcap_bin}"
  log "Granted cap_net_raw,cap_net_admin to ${dumpcap_bin} for group 'wireshark'."
}

apply_sysctl_tuning() {
  local rmem_max rmem_default backlog somaxconn swappiness
  case "${PROFILE}" in
    small)  rmem_max=8388608;   rmem_default=4194304;  backlog=2000;  somaxconn=1024; swappiness=10 ;;
    medium) rmem_max=33554432;  rmem_default=8388608;  backlog=5000;  somaxconn=4096; swappiness=5 ;;
    large)  rmem_max=67108864;  rmem_default=16777216; backlog=10000; somaxconn=8192; swappiness=1 ;;
    xl)     rmem_max=134217728; rmem_default=33554432; backlog=20000; somaxconn=16384; swappiness=1 ;;
  esac

  cat > "${SYSCTL_FILE}" <<-EOF
	# Managed by amdai install-linux.sh — profile: ${PROFILE}. Safe to regenerate.
	net.core.rmem_max = ${rmem_max}
	net.core.rmem_default = ${rmem_default}
	net.core.netdev_max_backlog = ${backlog}
	net.core.somaxconn = ${somaxconn}
	vm.swappiness = ${swappiness}
	EOF
  sysctl --system >/dev/null
  log "Applied sysctl tuning to ${SYSCTL_FILE}"
}

install_node_if_missing() {
  if command -v node >/dev/null 2>&1 && [ "$(node -v | sed 's/^v//; s/\..*//')" -ge 20 ]; then
    return 0
  fi
  log "Installing Node.js 20 (NodeSource)."
  curl -fsSL https://deb.nodesource.com/setup_20.x 2>/dev/null | bash - >/dev/null 2>&1 || true
  if command -v apt-get >/dev/null 2>&1; then apt-get install -y nodejs; fi
  if command -v dnf >/dev/null 2>&1; then dnf install -y nodejs; fi
}

build_and_stage_collector() {
  local repo_collector_dir
  repo_collector_dir="$(cd -- "${SCRIPT_DIR}/.." &>/dev/null && pwd)"
  log "Staging collector application from ${repo_collector_dir} to ${AMDAI_COLLECTOR_HOME}"
  rsync -a --delete --exclude node_modules --exclude data --exclude config \
    "${repo_collector_dir}/" "${AMDAI_COLLECTOR_HOME}/" 2>/dev/null || \
    cp -a "${repo_collector_dir}/." "${AMDAI_COLLECTOR_HOME}/"
  (cd "${AMDAI_COLLECTOR_HOME}" && npm ci --omit=dev || npm install --omit=dev)
  (cd "${AMDAI_COLLECTOR_HOME}" && npm run build)
  chown -R "${AMDAI_USER}:${AMDAI_GROUP}" "${AMDAI_COLLECTOR_HOME}"
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
  chown "${AMDAI_USER}:${AMDAI_GROUP}" "${env_file}"
  chmod 600 "${env_file}"
}

write_systemd_units() {
  cat > /etc/systemd/system/amdai-collector.service <<-EOF
	[Unit]
	Description=AMDAI Collector (capture, flow receivers, probes, uplink)
	After=network-online.target postgresql.service
	Wants=network-online.target

	[Service]
	Type=simple
	User=${AMDAI_USER}
	Group=${AMDAI_GROUP}
	EnvironmentFile=${AMDAI_HOME}/collector.env
	WorkingDirectory=${AMDAI_COLLECTOR_HOME}
	ExecStart=/usr/bin/node ${AMDAI_COLLECTOR_HOME}/dist/index.js
	Restart=on-failure
	RestartSec=5
	# Grants only the two capabilities the capture pipeline needs; the unit
	# itself still runs as the unprivileged amdai user.
	AmbientCapabilities=CAP_NET_RAW CAP_NET_ADMIN
	CapabilityBoundingSet=CAP_NET_RAW CAP_NET_ADMIN
	NoNewPrivileges=false
	ProtectSystem=strict
	ProtectHome=true
	ReadWritePaths=${AMDAI_COLLECTOR_HOME}/data ${AMDAI_COLLECTOR_HOME}/config
	PrivateTmp=true
	ProtectKernelTunables=true
	ProtectControlGroups=true
	RestrictSUIDSGID=true
	LockPersonality=true

	[Install]
	WantedBy=multi-user.target
	EOF

  cat > /etc/systemd/system/amdai-app.service <<-EOF
	[Unit]
	Description=AMDAI local console/app tier (optional, for offline/standalone appliances)
	After=network-online.target amdai-collector.service
	Wants=network-online.target

	[Service]
	Type=simple
	User=${AMDAI_USER}
	Group=${AMDAI_GROUP}
	EnvironmentFile=${AMDAI_HOME}/collector.env
	WorkingDirectory=${AMDAI_APP_HOME}
	ExecStart=/usr/bin/node ${AMDAI_APP_HOME}/dist/server/index.mjs
	Restart=on-failure
	RestartSec=5
	NoNewPrivileges=true
	ProtectSystem=strict
	ProtectHome=true
	ReadWritePaths=${AMDAI_APP_HOME}
	PrivateTmp=true
	ProtectKernelTunables=true
	ProtectControlGroups=true
	RestrictSUIDSGID=true
	LockPersonality=true

	[Install]
	WantedBy=multi-user.target
	EOF

  systemctl daemon-reload
  systemctl enable --now amdai-collector.service
  # amdai-app.service is only started if the app tier was actually staged
  # (e.g. on an all-in-one appliance install); on collector-only hosts
  # leave it disabled.
  if [ -f "${AMDAI_APP_HOME}/dist/server/index.mjs" ]; then
    systemctl enable --now amdai-app.service
  else
    log "No app tier staged at ${AMDAI_APP_HOME}; amdai-app.service left disabled."
  fi
}

print_pairing_instructions() {
  cat <<-EOF

	=============================================================================
	AMDAI collector installed successfully.

	  Profile:      ${PROFILE}
	  Local DB:     ${AMDAI_LOCAL_PG%%:*}://***@127.0.0.1:5432/${AMDAI_DB}
	  Console URL:  ${CONSOLE_URL:-<not set — edit ${AMDAI_HOME}/collector.env>}
	  Service:      systemctl status amdai-collector.service

	Next steps:
	  1. In the AMDAI console, go to Collectors -> Add Collector and issue a
	     pairing token if you have not already (this is the --token value).
	  2. Confirm the collector goes "online" within ~1 minute (heartbeat is
	     every ${HEARTBEAT_SECONDS:-20}s).
	  3. Point NetFlow/IPFIX/sFlow exporters or an NPB SPAN/TAP port at this
	     host's interfaces — see collector/README.md for exact steps.
	  4. Run collector/scripts/preflight.sh any time to re-validate readiness.
	=============================================================================
	EOF
}

main() {
  require_root
  parse_args "$@"
  pick_profile
  confirm_or_die "Install AMDAI collector with profile '${PROFILE}'?"
  detect_pkg_manager_and_install
  ensure_postgres_running
  ensure_db_and_extension
  apply_postgres_tuning
  create_amdai_user
  grant_dumpcap_capability
  apply_sysctl_tuning
  install_node_if_missing
  build_and_stage_collector
  write_env_file
  write_systemd_units
  print_pairing_instructions
}

main "$@"
