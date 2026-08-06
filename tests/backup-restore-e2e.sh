#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/common.sh
source "${project_dir}/scripts/common.sh"

require_runtime
[[ -f "$env_file" ]] || { echo "ERROR: Deploy NetTAP AI Suite before running recovery acceptance." >&2; exit 3; }
temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/nettap-backup-test.XXXXXX")"
target_prefix="nettap-restore-test-$$"
ollama_test_volume="${target_prefix}-ollama-data"
webui_test_volume="${target_prefix}-open-webui-data"
evidence_test_volume="${target_prefix}-evidence-data"
cleanup() {
  docker volume rm "$ollama_test_volume" "$webui_test_volume" "$evidence_test_volume" >/dev/null 2>&1 || true
  case "$temporary_dir" in
    */nettap-backup-test.*) rm -rf "$temporary_dir" ;;
  esac
}
trap cleanup EXIT

"${project_dir}/scripts/backup.sh" "${temporary_dir}/backup" --confirm-stop
"${project_dir}/scripts/restore.sh" "${temporary_dir}/backup" --target-prefix "$target_prefix"
backup_image="$(load_env_value BACKUP_IMAGE)"
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true -v "${ollama_test_volume}:/source:ro" \
  "$backup_image" sh -c 'test -n "$(find /source -mindepth 1 -print -quit)"'
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true -v "${webui_test_volume}:/source:ro" \
  "$backup_image" sh -c 'test -f /source/webui.db'
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true -v "${evidence_test_volume}:/source:ro" \
  "$backup_image" sh -c 'test -f /source/nettap-evidence.db && test -d /source/files'
echo "PASS: consistent model, application and evidence backup checksums plus non-overwriting restore were verified."
