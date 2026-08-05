#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

usage() {
  echo "Usage: ./scripts/restore.sh <backup-directory> --target-prefix <unique-prefix>" >&2
  exit 2
}
[[ $# -eq 3 && "$2" == "--target-prefix" ]] || usage
backup_dir="$1"
target_prefix="$3"
[[ -d "$backup_dir" && "$target_prefix" =~ ^[a-z0-9][a-z0-9-]{2,40}$ ]] || usage
backup_dir="$(cd "$backup_dir" && pwd)"
require_runtime
initialize_env
backup_image="$(load_env_value BACKUP_IMAGE)"
for file in SHA256SUMS manifest.txt ollama-data.tgz open-webui-data.tgz; do
  [[ -f "${backup_dir}/${file}" ]] || { echo "ERROR: Missing backup file: $file" >&2; exit 4; }
done
(cd "$backup_dir" && if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 -c SHA256SUMS
else
  sha256sum -c SHA256SUMS
fi)
ollama_volume="${target_prefix}-ollama-data"
webui_volume="${target_prefix}-open-webui-data"
for volume in "$ollama_volume" "$webui_volume"; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    echo "ERROR: Target volume already exists; restore never overwrites: $volume" >&2
    exit 5
  fi
done
docker volume create "$ollama_volume" >/dev/null
docker volume create "$webui_volume" >/dev/null
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true -v "${ollama_volume}:/target" -v "${backup_dir}:/backup:ro" \
  "$backup_image" sh -c 'cd /target && tar xzf /backup/ollama-data.tgz'
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true -v "${webui_volume}:/target" -v "${backup_dir}:/backup:ro" \
  "$backup_image" sh -c 'cd /target && tar xzf /backup/open-webui-data.tgz'
echo "Restore completed into new, unconnected volumes:"
echo "  $ollama_volume"
echo "  $webui_volume"
echo "No running deployment or existing volume was changed."
