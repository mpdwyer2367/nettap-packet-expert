#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

email=""
display_name=""
role=""
create_if_missing=false
confirmed=false

usage() {
  cat <<'EOF' >&2
Usage: ./scripts/nettap-ai reset-password --email <email> --name <name> --role admin [--create-if-missing] --confirm

The replacement password is requested twice without echo and is never accepted
as a command-line argument. Local loopback deployment only.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email) [[ $# -ge 2 ]] || { usage; exit 2; }; email="$2"; shift ;;
    --name) [[ $# -ge 2 ]] || { usage; exit 2; }; display_name="$2"; shift ;;
    --role) [[ $# -ge 2 ]] || { usage; exit 2; }; role="$2"; shift ;;
    --create-if-missing) create_if_missing=true ;;
    --confirm) confirmed=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

[[ "$confirmed" == true && -n "$email" && -n "$display_name" && "$role" == admin ]] || {
  usage
  exit 2
}
[[ "$email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || {
  echo "ERROR: Invalid administrator email address." >&2
  exit 2
}

require_runtime
initialize_env
[[ "$(load_env_value DEPLOYMENT_MODE)" == local ]] || {
  echo "ERROR: Password recovery is available only in local deployment mode." >&2
  exit 3
}
[[ "$(load_env_value BIND_ADDRESS)" == 127.0.0.1 ]] || {
  echo "ERROR: Password recovery requires loopback binding at 127.0.0.1." >&2
  exit 3
}
docker info >/dev/null 2>&1 || {
  echo "ERROR: Docker Desktop is installed but its engine is not running." >&2
  exit 3
}

printf 'New Open WebUI administrator password: ' >&2
IFS= read -r -s password
printf '\nConfirm new password: ' >&2
IFS= read -r -s confirmation
printf '\n' >&2
[[ -n "$password" ]] || { echo "ERROR: Password is empty." >&2; exit 4; }
[[ "$password" == "$confirmation" ]] || { echo "ERROR: Passwords do not match." >&2; exit 4; }
unset confirmation

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

"${compose_local[@]}" stop open-webui >/dev/null 2>&1 || true
printf '%s\n' "$password" | "${compose_local[@]}" --profile provision run --rm --no-deps -T \
  --entrypoint python \
  -e "NETTAP_RESET_ADMIN_EMAIL=${email}" \
  -e "NETTAP_RESET_ADMIN_NAME=${display_name}" \
  -e "NETTAP_RESET_CREATE_IF_MISSING=${create_if_missing}" \
  assistant-provisioner /provision/reset_local_admin.py

set_env_value WEBUI_ADMIN_NAME "$display_name"
set_env_value WEBUI_ADMIN_EMAIL "$email"
set_env_value WEBUI_ADMIN_PASSWORD "$password"
umask 077
{
  printf 'Login: %s\n' "$email"
  printf 'Password reset UTC: %s\n' "$(date -u +%FT%TZ)"
} > "$bootstrap_password_file"
chmod 0600 "$bootstrap_password_file"
rm -f "$admin_finalized_file"

"${compose_local[@]}" up -d --wait open-webui
printf '%s\n' "$password" | "${compose_local[@]}" --profile provision run --rm -T \
  assistant-provisioner --verify-admin
provision_assistants local
trap - EXIT
unset password

echo "Open WebUI administrator access restored."
echo "Login URL: http://127.0.0.1:$(load_env_value WEB_PORT)"
echo "Email: $email"
echo "The password remains protected in the mode-0600 local .env for automated provisioning."
