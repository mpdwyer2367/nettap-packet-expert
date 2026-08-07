#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

usage() {
  echo "Usage: ./scripts/recover-admin.sh --confirm [--email existing-admin@example.com]" >&2
  echo "This operation backs up the Open WebUI database, resets the selected administrator to the canonical identity, and invalidates existing sessions." >&2
}

[[ "${1:-}" == "--confirm" ]] || {
  usage
  exit 2
}
shift

recovery_email=""
if (( $# > 0 )); then
  [[ "${1:-}" == "--email" && $# -eq 2 ]] || { usage; exit 2; }
  recovery_email="$2"
  [[ -n "$recovery_email" && "$recovery_email" != *$'\n'* && "$recovery_email" != *$'\r'* ]] || {
    echo "ERROR: --email requires one valid, single-line administrator email." >&2
    exit 2
  }
fi

require_runtime
[[ -f "$env_file" ]] || { echo "ERROR: Deployment is not initialized." >&2; exit 3; }
docker info >/dev/null 2>&1 || { echo "ERROR: Docker engine is not running." >&2; exit 3; }

mode="$(load_env_value DEPLOYMENT_MODE)"
if [[ "$mode" == production ]]; then
  selected=("${compose_production[@]}")
else
  selected=("${compose_local[@]}")
fi

webui_id="$("${selected[@]}" ps -q open-webui)"
[[ -n "$webui_id" ]] || {
  echo "ERROR: Open WebUI is not running. Start the failed deployment far enough to create the diagnostic Open WebUI service, then retry." >&2
  exit 4
}

effective_project="$(deployment_project_name)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${project_dir}/backups/admin-recovery-${timestamp}"
container_backup="/app/backend/data/nettap-admin-recovery-${timestamp}.db"
[[ ! -e "$backup_dir" ]] || { echo "ERROR: Recovery backup destination already exists: $backup_dir" >&2; exit 4; }
mkdir -p "$backup_dir"
chmod 0700 "$backup_dir"

cleanup_container_backup() {
  docker exec "$webui_id" python -c \
    'from pathlib import Path; import sys; Path(sys.argv[1]).unlink(missing_ok=True)' \
    "$container_backup" >/dev/null 2>&1 || true
}
trap cleanup_container_backup EXIT

"${selected[@]}" exec -T -e "NETTAP_RECOVERY_ADMIN_EMAIL=${recovery_email}" open-webui python - "$container_backup" <<'PY'
import os
import sqlite3
import sys

database = "/app/backend/data/webui.db"
destination = sys.argv[1]
source = sqlite3.connect(database, timeout=30)
recovery_email = os.environ.get("NETTAP_RECOVERY_ADMIN_EMAIL", "").strip()
if recovery_email:
    admins = source.execute(
        "SELECT a.id FROM auth AS a JOIN user AS u ON u.id = a.id "
        "WHERE u.role = ? AND (lower(a.email) = lower(?) OR lower(u.email) = lower(?))",
        ("admin", recovery_email, recovery_email),
    ).fetchall()
    failure = f"selected administrator {recovery_email!r} matched {len(admins)} accounts"
else:
    admins = source.execute(
        "SELECT a.id FROM auth AS a JOIN user AS u ON u.id = a.id WHERE u.role = ?",
        ("admin",),
    ).fetchall()
    failure = f"recovery requires exactly one administrator; found {len(admins)}"
if len(admins) != 1:
    raise SystemExit(failure)
backup = sqlite3.connect(destination)
source.backup(backup)
backup.close()
source.close()
PY

docker cp "${webui_id}:${container_backup}" "${backup_dir}/webui.db"
cleanup_container_backup
trap - EXIT
chmod 0600 "${backup_dir}/webui.db"
(cd "$backup_dir" && sha256_file webui.db) > "${backup_dir}/SHA256SUMS"
chmod 0600 "${backup_dir}/SHA256SUMS"

reset_python="$(<"${project_dir}/scripts/recover_open_webui_admin.py")"

recovery_password="Ntp!9$(openssl rand -hex 12)"
if ! printf '%s\n' "$recovery_password" | \
  "${selected[@]}" exec -T -e "NETTAP_RECOVERY_ADMIN_EMAIL=${recovery_email}" open-webui python -c "$reset_python"; then
  unset recovery_password reset_python
  echo "ERROR: Administrator recovery failed. The original database backup is available at $backup_dir." >&2
  exit 5
fi
unset reset_python

session_secret="$(openssl rand -hex 32)"
set_env_value WEBUI_SECRET_KEY "$session_secret"
set_env_value WEBUI_ADMIN_NAME "NetTAP Administrator"
set_env_value WEBUI_ADMIN_EMAIL "admin@nettap.local"
set_env_value WEBUI_ADMIN_PASSWORD "$recovery_password"
unset session_secret

umask 077
{
  printf 'Login: admin@nettap.local\n'
  printf 'Bootstrap password: %s\n' "$recovery_password"
  printf 'Recovery UTC: %s\n' "$(date -u +%FT%TZ)"
  printf 'Compose project: %s\n' "$effective_project"
  printf 'Database backup: %s\n' "$backup_dir"
} > "$bootstrap_password_file"
chmod 0600 "$bootstrap_password_file"
unset recovery_password
rm -f "$admin_finalized_file"

"${selected[@]}" up -d --force-recreate open-webui
ready=false
for _ in $(seq 1 90); do
  webui_id="$("${selected[@]}" ps -q open-webui)"
  if [[ -n "$webui_id" ]]; then
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$webui_id" 2>/dev/null || true)"
    if [[ "$health" == healthy ]]; then
      ready=true
      break
    fi
  fi
  sleep 2
done
[[ "$ready" == true ]] || {
  echo "ERROR: Open WebUI did not become healthy after recovery. The database backup is available at $backup_dir." >&2
  exit 6
}

echo "Administrator recovery completed for $effective_project."
echo "Database backup: $backup_dir"
echo "One-time credential: $bootstrap_password_file"
echo "All prior Open WebUI sessions were invalidated."
echo "Rerun the platform start command to provision the assistants with the recovered account."
