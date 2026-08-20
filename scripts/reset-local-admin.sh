#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

[[ "${1:-}" == "--confirm-insecure-default" && $# -eq 1 ]] || {
  echo "Usage: ./scripts/reset-local-admin.sh --confirm-insecure-default" >&2
  exit 2
}

require_runtime
initialize_env
[[ "$(load_env_value DEPLOYMENT_MODE)" == "local" ]] || {
  echo "ERROR: The default-password reset is available only in local deployment mode." >&2
  exit 3
}
[[ "$(load_env_value BIND_ADDRESS)" == "127.0.0.1" ]] || {
  echo "ERROR: Refusing a default password unless Open WebUI is bound to 127.0.0.1." >&2
  exit 3
}
docker info >/dev/null 2>&1 || {
  echo "ERROR: Docker Desktop is installed but its engine is not running." >&2
  exit 3
}

admin_email="admin@nettap.local"
admin_name="admin"
admin_password="password"
webui_was_running=false
webui_id="$("${compose_local[@]}" ps -q open-webui 2>/dev/null || true)"
if [[ -n "$webui_id" && "$(docker inspect -f '{{.State.Running}}' "$webui_id")" == true ]]; then
  webui_was_running=true
fi

restart_after_failure() {
  if [[ "$webui_was_running" == true ]]; then
    "${compose_local[@]}" up -d open-webui >/dev/null 2>&1 || true
  fi
}
trap restart_after_failure EXIT

echo "WARNING: This installs the intentionally weak local credential admin@nettap.local / password."
echo "It is refused for production mode or non-loopback binding."
"${compose_local[@]}" stop open-webui >/dev/null 2>&1 || true
printf '%s\n' "$admin_password" | "${compose_local[@]}" --profile provision run --rm --no-deps -T \
  --entrypoint python \
  -e "NETTAP_RESET_ADMIN_EMAIL=${admin_email}" \
  -e "NETTAP_RESET_ADMIN_NAME=${admin_name}" \
  assistant-provisioner /provision/reset_local_admin.py

set_env_value WEBUI_ADMIN_NAME "$admin_name"
set_env_value WEBUI_ADMIN_EMAIL "$admin_email"
set_env_value WEBUI_ADMIN_PASSWORD "$admin_password"
umask 077
{
  printf 'Login: %s\n' "$admin_email"
  printf 'Bootstrap password: %s\n' "$admin_password"
  printf 'Local insecure reset UTC: %s\n' "$(date -u +%FT%TZ)"
} > "$bootstrap_password_file"
chmod 0600 "$bootstrap_password_file"
rm -f "$admin_finalized_file"

"${compose_local[@]}" up -d --wait open-webui
provision_assistants local
trap - EXIT
unset admin_password

echo "Local administrator access restored."
echo "Login URL: http://127.0.0.1:$(load_env_value WEB_PORT)"
echo "Email: $admin_email"
echo "Password: password"
echo "Production remains blocked until this password is replaced and administrator activation is finalized."
