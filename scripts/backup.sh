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
project_name="${COMPOSE_PROJECT_NAME:-nettap-network-intelligence}"
[[ "$project_name" =~ ^[a-z0-9][a-z0-9_-]{2,62}$ ]] || {
  echo "ERROR: Invalid Compose project name for backup provenance: $project_name" >&2
  exit 4
}
mode="$(load_env_value DEPLOYMENT_MODE)"
restart_required=false
model_lock="${project_dir}/reports/generated/model-lock.txt"
if [[ "$mode" == production && ! -s "$model_lock" ]]; then
  echo "ERROR: Production backup requires the model identity record created during initialization." >&2
  exit 4
fi

restart_application() {
  if [[ "$restart_required" == true ]]; then
    if [[ "$mode" == production ]]; then
      "${compose_production[@]}" up -d ollama open-webui evidence-service gateway
    else
      "${compose_local[@]}" up -d ollama open-webui evidence-service
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
backup_volume "${project_name}_packet-expert-evidence-data" evidence-data.tgz
{
  printf 'Backup format: NetTAP AI Suite volume backup v3\n'
  printf 'Created UTC: %s\n' "$(date -u +%FT%TZ)"
  printf 'Release: %s\n' "$(load_env_value RELEASE_VERSION)"
  printf 'NetTAP AI model: %s\n' "$(load_env_value NETTAP_AI_MODEL)"
  printf 'Source project: %s\n' "$project_name"
  printf 'Deployment mode: %s\n' "$mode"
  for key in OLLAMA_IMAGE OPEN_WEBUI_IMAGE CADDY_IMAGE BACKUP_IMAGE; do
    printf '%s=%s\n' "$key" "$(load_env_value "$key")"
  done
  if [[ "${NETTAP_SOURCE_COMMIT:-}" =~ ^[0-9a-f]{40}$ ]]; then
    printf 'Source commit: %s\n' "$NETTAP_SOURCE_COMMIT"
  elif git -C "$project_dir" rev-parse --verify HEAD >/dev/null 2>&1; then
    printf 'Source commit: %s\n' "$(git -C "$project_dir" rev-parse HEAD)"
  else
    printf 'Source commit: packaged-release-no-git-metadata\n'
  fi
  if [[ -s "$model_lock" ]]; then
    sed -n '/^Base model ID: /p;/^NetTAP AI model ID: /p' "$model_lock"
  else
    printf 'Base model ID: unavailable-local-evaluation\n'
    printf 'NetTAP AI model ID: unavailable-local-evaluation\n'
  fi
} > "${output_dir}/manifest.txt"
(cd "$output_dir" && {
  sha256_file ollama-data.tgz
  sha256_file open-webui-data.tgz
  sha256_file evidence-data.tgz
  sha256_file manifest.txt
}) > "${output_dir}/SHA256SUMS"
chmod -R go-rwx "$output_dir"
restart_application
trap - EXIT
echo "Backup completed: $output_dir"
echo "Treat it as sensitive: it contains accounts, chats, knowledge, model data, cases, and raw evidence."
