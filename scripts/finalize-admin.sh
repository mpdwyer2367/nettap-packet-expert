#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

[[ "${1:-}" == "--confirm" && $# -eq 1 ]] || {
  echo "Usage: ./scripts/finalize-admin.sh --confirm" >&2
  exit 2
}
require_runtime
[[ -f "$env_file" ]] || { echo "ERROR: Deployment is not initialized." >&2; exit 3; }
[[ -f "$bootstrap_password_file" ]] || { echo "Administrator bootstrap is already finalized or the credential record is missing."; exit 0; }

mode="$(load_env_value DEPLOYMENT_MODE)"
if [[ "$mode" == "production" ]]; then
  selected=("${compose_production[@]}")
else
  selected=("${compose_local[@]}")
fi
admin_count="$("${selected[@]}" exec -T open-webui python - <<'PY'
import sqlite3
db = sqlite3.connect('/app/backend/data/webui.db')
print(db.execute("SELECT COUNT(*) FROM user WHERE role = 'admin'").fetchone()[0])
PY
)"
[[ "$admin_count" -ge 1 ]] || { echo "ERROR: No administrator account exists." >&2; exit 4; }

echo "Confirm that you changed the generated password, signed out, and verified the generated password no longer works."
printf 'Type FINALIZE to retire the local bootstrap credential: '
read -r confirmation
[[ "$confirmation" == "FINALIZE" ]] || { echo "Finalization cancelled."; exit 5; }

set_env_value WEBUI_ADMIN_PASSWORD "BOOTSTRAP_RETIRED"
rm -f "$bootstrap_password_file"
umask 077
{
  printf 'Administrator bootstrap finalized UTC: %s\n' "$(date -u +%FT%TZ)"
  printf 'Administrator email: %s\n' "$(load_env_value WEBUI_ADMIN_EMAIL)"
  printf 'Operator confirmed old bootstrap credential rejection.\n'
} > "$admin_finalized_file"
chmod 0600 "$admin_finalized_file"
echo "Administrator bootstrap retired. Production gateway activation is now permitted after the remaining preflight gates pass."
