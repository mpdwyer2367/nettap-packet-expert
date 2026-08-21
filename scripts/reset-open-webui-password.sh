#!/usr/bin/env bash
set -euo pipefail
set +x

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

usage() {
  echo "Usage: ./scripts/nettap-ai reset-password --email ADDRESS [--name NAME] [--role admin|user] [--create-if-missing] --confirm" >&2
  exit 2
}

email=""
name="NetTAP Administrator"
role="user"
create_if_missing=false
confirmed=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --email) [[ $# -ge 2 ]] || usage; email="$2"; shift 2 ;;
    --name) [[ $# -ge 2 ]] || usage; name="$2"; shift 2 ;;
    --role) [[ $# -ge 2 ]] || usage; role="$2"; shift 2 ;;
    --create-if-missing) create_if_missing=true; shift ;;
    --confirm) confirmed=true; shift ;;
    *) usage ;;
  esac
done

[[ "$confirmed" == true && -n "$email" ]] || usage
[[ "$role" == admin || "$role" == user ]] || usage
[[ -t 0 ]] || {
  echo "ERROR: Run this recovery command from an interactive terminal so the password is not stored in shell history." >&2
  exit 2
}

require_runtime
require_command openssl
[[ -f "$env_file" ]] || { echo "ERROR: Deployment is not initialized; .env is missing." >&2; exit 3; }

mode="$(load_env_value DEPLOYMENT_MODE)"
if [[ "$mode" == production ]]; then
  selected=("${compose_production[@]}")
else
  selected=("${compose_local[@]}")
fi
[[ -n "$("${selected[@]}" ps -q open-webui 2>/dev/null)" ]] || {
  echo "ERROR: Open WebUI is not running. Start the deployment before recovering an account." >&2
  exit 3
}

printf 'New password for %s: ' "$email" >&2
IFS= read -r -s password
printf '\nConfirm new password: ' >&2
IFS= read -r -s confirmation
printf '\n' >&2
[[ "$password" == "$confirmation" ]] || {
  unset password confirmation
  echo "ERROR: Passwords did not match; no account change was attempted." >&2
  exit 4
}
unset confirmation

manage_args=(manage --email "$email" --name "$name" --role "$role")
if [[ "$create_if_missing" == true ]]; then manage_args+=(--create-if-missing); fi
if ! result="$(printf '%s\n' "$password" | "${selected[@]}" exec -T open-webui \
  python /nettap-provisioning/manage_open_webui_user.py "${manage_args[@]}")"; then
  unset password
  echo "ERROR: Open WebUI account recovery failed. Review the reported error and preserve the recovery backup." >&2
  exit 4
fi

new_secret="$(openssl rand -hex 32)"
set_env_value WEBUI_SECRET_KEY "$new_secret"
unset new_secret
"${selected[@]}" up -d --force-recreate open-webui >/dev/null

ready=false
for _ in $(seq 1 60); do
  if "${selected[@]}" exec -T open-webui python -c \
    "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3)" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
[[ "$ready" == true ]] || {
  unset password
  echo "ERROR: Account changed, but Open WebUI did not become healthy after session invalidation." >&2
  echo "$result" >&2
  exit 5
}

if ! printf '%s\n' "$password" | "${selected[@]}" exec -T open-webui \
  python /nettap-provisioning/manage_open_webui_user.py verify --email "$email" >/dev/null; then
  unset password
  echo "ERROR: Open WebUI restarted, but the new credential did not verify." >&2
  exit 5
fi
unset password

echo "$result"
echo "Account access verified. All earlier Open WebUI sessions were invalidated."
echo "Sign in at http://127.0.0.1:$(load_env_value WEB_PORT)/auth?redirect=%2F"
