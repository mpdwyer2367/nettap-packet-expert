#!/usr/bin/env bash
set -euo pipefail

project_dir="${NETTAP_HOME:-/opt/nettap/current}"
env_file="${NETTAP_ENV_FILE:-/etc/nettap/nettap.env}"
state_dir="${NETTAP_STATE_DIR:-/var/lib/nettap/state}"
marker="${state_dir}/firstboot-complete"

[[ "$(id -u)" -eq 0 ]] || { echo "ERROR: firstboot must run as root." >&2; exit 3; }
[[ -L "$project_dir" || -d "$project_dir" ]] || { echo "ERROR: NetTAP release is not installed." >&2; exit 4; }
[[ -f "$marker" ]] && exit 0

umask 077
install -d -m 0750 /etc/nettap /etc/nettap/tls
install -d -m 0700 "$state_dir"
install -d -m 0750 \
  /var/lib/nettap/ollama \
  /var/lib/nettap/open-webui \
  /var/lib/nettap/evidence \
  /var/lib/nettap/gateway/data \
  /var/lib/nettap/gateway/config \
  /var/lib/nettap/backups \
  /var/lib/nettap/reports \
  /var/log/nettap

if [[ ! -s /etc/machine-id ]]; then
  systemd-machine-id-setup
fi
ssh-keygen -A
if id packer >/dev/null 2>&1; then
  userdel -r packer >/dev/null 2>&1 || true
fi

if [[ ! -f "$env_file" ]]; then
  env_template="${project_dir}/.env.example"
  if [[ -f /etc/nettap/nettap.env.locked-template ]]; then
    env_template=/etc/nettap/nettap.env.locked-template
  fi
  install -m 0600 "$env_template" "$env_file"
  sed -i \
    -e 's/^DEPLOYMENT_MODE=.*/DEPLOYMENT_MODE=production/' \
    -e 's/^HTTPS_BIND_ADDRESS=.*/HTTPS_BIND_ADDRESS=0.0.0.0/' \
    -e 's/^WEBUI_SECRET_KEY=.*/WEBUI_SECRET_KEY=GENERATE_ON_FIRST_START/' \
    -e 's/^WEBUI_ADMIN_PASSWORD=.*/WEBUI_ADMIN_PASSWORD=GENERATE_ON_FIRST_START/' \
    -e 's/^EVIDENCE_API_TOKEN=.*/EVIDENCE_API_TOKEN=GENERATE_ON_FIRST_START/' \
    "$env_file"
fi

# Reuse the application bootstrap code so the Open WebUI and evidence secrets
# have the same format and file protections across deployment types.
# shellcheck source=../scripts/common.sh
# shellcheck disable=SC1091 # Resolved from /opt/nettap/current at appliance runtime.
source "${project_dir}/scripts/common.sh"
initialize_env

if [[ ! -s /etc/nettap/tls/tls.crt || ! -s /etc/nettap/tls/tls.key ]]; then
  hostname="$(load_env_value APPLIANCE_HOSTNAME)"
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 30 \
    -subj "/CN=${hostname}" \
    -addext "subjectAltName=DNS:${hostname},DNS:localhost,IP:127.0.0.1" \
    -keyout /etc/nettap/tls/tls.key \
    -out /etc/nettap/tls/tls.crt >/dev/null 2>&1
  chmod 0600 /etc/nettap/tls/tls.key
  chmod 0644 /etc/nettap/tls/tls.crt
fi

os_password="Ntp!$(openssl rand -hex 14)"
printf 'nettap-admin:%s\n' "$os_password" | chpasswd
chage -d 0 nettap-admin

bootstrap_file="${state_dir}/bootstrap.txt"
{
  printf 'NetTAP appliance bootstrap credentials\n'
  printf 'Generated UTC: %s\n' "$(date -u +%FT%TZ)"
  printf 'SSH user: nettap-admin\n'
  printf 'SSH one-time password: %s\n' "$os_password"
  printf 'Open WebUI login: %s\n' "$(load_env_value WEBUI_ADMIN_EMAIL)"
  printf 'Open WebUI bootstrap password: %s\n' "$(load_env_value WEBUI_ADMIN_PASSWORD)"
  printf 'HTTPS: https://%s:%s/\n' "$(load_env_value APPLIANCE_HOSTNAME)" "$(load_env_value HTTPS_PORT)"
  printf 'TLS: self-signed bootstrap certificate; replace before production use\n'
} > "$bootstrap_file"
chmod 0600 "$bootstrap_file"
unset os_password

{
  printf 'First boot UTC: %s\n' "$(date -u +%FT%TZ)"
  printf 'Machine ID: %s\n' "$(cat /etc/machine-id)"
  printf 'SSH host ED25519: %s\n' "$(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub | awk '{print $2}')"
  printf 'TLS SHA256: %s\n' "$(openssl x509 -in /etc/nettap/tls/tls.crt -noout -fingerprint -sha256 | cut -d= -f2)"
} > "$marker"
chmod 0600 "$marker"

if [[ -w /dev/tty1 ]]; then
  {
    printf '\nNetTAP first boot is ready. Unique credentials follow.\n'
    sed -n '/^SSH user:/p;/^SSH one-time password:/p;/^Open WebUI login:/p;/^Open WebUI bootstrap password:/p;/^HTTPS:/p' "$bootstrap_file"
    printf 'Change both passwords immediately. This message is shown only once.\n\n'
  } > /dev/tty1
fi
logger -t nettap-firstboot "Unique machine identity, SSH keys, TLS key, and bootstrap credentials generated"
