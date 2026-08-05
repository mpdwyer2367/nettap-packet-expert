#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

[[ "${1:-}" == "--confirm" ]] || {
  echo "Usage: ./scripts/lock-images.sh --confirm" >&2
  echo "Pulls bootstrap tags and records immutable repository digests in .env." >&2
  exit 2
}

require_runtime
initialize_env

lock_image() {
  local key="$1" reference digest
  reference="$(load_env_value "$key")"
  [[ -n "$reference" ]] || { echo "ERROR: $key is empty." >&2; exit 4; }
  docker pull "$reference" >/dev/null
  digest="$(docker image inspect --format '{{index .RepoDigests 0}}' "$reference" 2>/dev/null || true)"
  [[ "$digest" == *@sha256:* ]] || {
    echo "ERROR: Registry did not provide an immutable RepoDigest for $reference." >&2
    exit 4
  }
  set_env_value "$key" "$digest"
  printf '%s=%s\n' "$key" "$digest"
}

for key in OLLAMA_IMAGE OPEN_WEBUI_IMAGE CADDY_IMAGE BACKUP_IMAGE; do
  lock_image "$key"
done
require_digest_pins
mkdir -p "${project_dir}/reports/generated"
{
  printf 'Image lock UTC: %s\n' "$(date -u +%FT%TZ)"
  printf 'Host architecture: %s\n' "$(uname -m)"
  for key in OLLAMA_IMAGE OPEN_WEBUI_IMAGE CADDY_IMAGE BACKUP_IMAGE; do
    printf '%s=%s\n' "$key" "$(load_env_value "$key")"
  done
} > "${project_dir}/reports/generated/image-lock.txt"
echo "Immutable image references recorded in reports/generated/image-lock.txt."
