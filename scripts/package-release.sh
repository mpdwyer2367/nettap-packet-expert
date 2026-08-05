#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

unsigned=false
[[ "${1:-}" == "--unsigned-candidate" ]] && unsigned=true
[[ -z "$(git -C "$project_dir" status --porcelain)" ]] || {
  echo "ERROR: Release packaging requires a clean Git worktree." >&2
  exit 13
}
initialize_env
version="$(load_env_value RELEASE_VERSION)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$ ]] || { echo "ERROR: Invalid release version." >&2; exit 13; }
mkdir -p "${project_dir}/dist"
archive="${project_dir}/dist/nettap-packet-expert-${version}-source.tar.gz"
git -C "$project_dir" archive --format=tar.gz --prefix="nettap-packet-expert-${version}/" -o "$archive" HEAD
(cd "${project_dir}/dist" && sha256_file "$(basename "$archive")") > "${archive}.sha256"
if [[ "$unsigned" == true ]]; then
  echo "Unsigned candidate created; it is not approved for commercial distribution."
else
  require_command cosign
  [[ -n "${COSIGN_KEY:-}" ]] || { echo "ERROR: COSIGN_KEY must identify the authorized release signing key." >&2; exit 13; }
  cosign sign-blob --yes --key "$COSIGN_KEY" --output-signature "${archive}.sig" "$archive"
  echo "Signed release package created."
fi
echo "$archive"
