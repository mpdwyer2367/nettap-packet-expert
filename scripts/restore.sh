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
backup_format="$(sed -n 's/^Backup format: //p' "${backup_dir}/manifest.txt")"
[[ "$backup_format" == 'NetTAP AI Suite volume backup v2' || \
   "$backup_format" == 'NetTAP AI Suite volume backup v3' ]] || {
  echo "ERROR: Unsupported or malformed backup manifest." >&2
  exit 4
}
if [[ "$backup_format" == 'NetTAP AI Suite volume backup v3' && ! -f "${backup_dir}/evidence-data.tgz" ]]; then
  echo "ERROR: Version 3 backup is missing evidence-data.tgz." >&2
  exit 4
fi
grep -Eq '^Source project: [a-z0-9][a-z0-9_-]{2,62}$' "${backup_dir}/manifest.txt" || {
  echo "ERROR: Backup source project identity is invalid." >&2
  exit 4
}
current_release="$(load_env_value RELEASE_VERSION)"
grep -Fqx "Release: $current_release" "${backup_dir}/manifest.txt" || {
  echo "ERROR: Backup release differs from $current_release. Restore it with the matching signed software release, then follow an approved migration procedure." >&2
  exit 4
}
ollama_volume="${target_prefix}-ollama-data"
webui_volume="${target_prefix}-open-webui-data"
evidence_volume="${target_prefix}-evidence-data"
target_volumes=("$ollama_volume" "$webui_volume")
if [[ "$backup_format" == 'NetTAP AI Suite volume backup v3' ]]; then
  target_volumes+=("$evidence_volume")
fi
for volume in "${target_volumes[@]}"; do
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
if [[ "$backup_format" == 'NetTAP AI Suite volume backup v3' ]]; then
  docker volume create "$evidence_volume" >/dev/null
  docker run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true -v "${evidence_volume}:/target" -v "${backup_dir}:/backup:ro" \
    "$backup_image" sh -c 'cd /target && tar xzf /backup/evidence-data.tgz'
fi
echo "Restore completed into new, unconnected volumes:"
echo "  $ollama_volume"
echo "  $webui_volume"
if [[ "$backup_format" == 'NetTAP AI Suite volume backup v3' ]]; then echo "  $evidence_volume"; fi
echo "No running deployment or existing volume was changed."
