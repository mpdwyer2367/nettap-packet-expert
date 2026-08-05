#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

require_runtime
initialize_env
backup_image="$(load_env_value BACKUP_IMAGE)"
[[ -n "$backup_image" ]] || { echo "ERROR: BACKUP_IMAGE is empty." >&2; exit 3; }
if [[ $# -eq 2 ]]; then
  [[ "$2" == "--confirm-stop" ]] || { echo "Usage: ./scripts/backup.sh [output-directory] --confirm-stop" >&2; exit 2; }
  output_dir="$1"
elif [[ $# -eq 1 ]]; then
  [[ "$1" == "--confirm-stop" ]] || { echo "Usage: ./scripts/backup.sh [output-directory] --confirm-stop" >&2; exit 2; }
  output_dir="${project_dir}/backups/$(date -u +%Y%m%dT%H%M%SZ)"
else
  echo "Usage: ./scripts/backup.sh [output-directory] --confirm-stop" >&2
  exit 2
fi
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
if [[ -n "$(find "$output_dir" -mindepth 1 -print -quit)" ]]; then
  echo "ERROR: Backup destination must be empty; existing files are never overwritten: $output_dir" >&2
  exit 4
fi
project_name="nettap-packet-expert"
mode="$(load_env_value DEPLOYMENT_MODE)"
restart_required=false

restart_application() {
  if [[ "$restart_required" == true ]]; then
    if [[ "$mode" == production ]]; then
      "${compose_production[@]}" up -d ollama open-webui gateway
    else
      "${compose_local[@]}" up -d ollama open-webui
    fi
    restart_required=false
  fi
}
trap restart_application EXIT

if [[ "$mode" == production ]]; then
  if [[ -n "$("${compose_production[@]}" ps -q 2>/dev/null)" ]]; then
    "${compose_production[@]}" down
    restart_required=true
  fi
else
  if [[ -n "$("${compose_local[@]}" ps -q 2>/dev/null)" ]]; then
    "${compose_local[@]}" down
    restart_required=true
  fi
fi

backup_volume() {
  local volume="$1" archive="$2"
  docker volume inspect "$volume" >/dev/null
  docker run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true \
    -v "${volume}:/source:ro" -v "${output_dir}:/backup" \
    "$backup_image" sh -c "cd /source && tar czf /backup/${archive} ."
}
backup_volume "${project_name}_packet-expert-ollama-data" ollama-data.tgz
backup_volume "${project_name}_packet-expert-open-webui-data" open-webui-data.tgz
{
  printf 'Backup format: NetTAP Packet Expert volume backup v1\n'
  printf 'Created UTC: %s\n' "$(date -u +%FT%TZ)"
  printf 'Release: %s\n' "$(load_env_value RELEASE_VERSION)"
  printf 'Model: %s\n' "$(load_env_value MODEL_NAME)"
  printf 'Source project: %s\n' "$project_name"
} > "${output_dir}/manifest.txt"
(cd "$output_dir" && {
  sha256_file ollama-data.tgz
  sha256_file open-webui-data.tgz
  sha256_file manifest.txt
}) > "${output_dir}/SHA256SUMS"
chmod -R go-rwx "$output_dir"
restart_application
trap - EXIT
echo "Backup completed: $output_dir"
echo "Treat it as sensitive: it contains accounts, chats, knowledge, and model data."
