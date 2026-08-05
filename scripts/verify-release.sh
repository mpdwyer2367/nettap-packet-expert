#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
archive="${1:-}"
public_key="${2:-}"
provenance="${archive}.provenance.txt"
[[ -f "$archive" && -f "${archive}.sha256" && -f "$provenance" ]] || {
  echo "Usage: ./scripts/verify-release.sh <archive> [cosign-public-key]" >&2
  exit 2
}
archive_dir="$(cd "$(dirname "$archive")" && pwd)"
archive_name="$(basename "$archive")"
(cd "$archive_dir" && if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 -c "${archive_name}.sha256"
else
  sha256sum -c "${archive_name}.sha256"
fi)
archive_digest="$(if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$archive"; else sha256sum "$archive"; fi | awk '{print $1}')"
grep -Fqx "Artifact: $archive_name" "$provenance" || { echo "ERROR: Provenance artifact name mismatch." >&2; exit 3; }
grep -Fqx "SHA256: $archive_digest" "$provenance" || { echo "ERROR: Provenance digest mismatch." >&2; exit 3; }
grep -Eq '^Version: [0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$' "$provenance" || { echo "ERROR: Provenance version is invalid." >&2; exit 3; }
grep -Eq '^Commit: [0-9a-f]{40}$' "$provenance" || { echo "ERROR: Provenance commit is invalid." >&2; exit 3; }
grep -Eq '^Tree: [0-9a-f]{40}$' "$provenance" || { echo "ERROR: Provenance tree is invalid." >&2; exit 3; }
version="$(sed -n 's/^Version: //p' "$provenance")"
commit="$(sed -n 's/^Commit: //p' "$provenance")"
tree="$(sed -n 's/^Tree: //p' "$provenance")"
python3 "${script_dir}/verify-archive-tree.py" \
  "$archive" --expected-prefix "nettap-ai-suite-${version}" --expected-tree "$tree"
if git -C "$project_dir" cat-file -e "${commit}^{commit}" >/dev/null 2>&1; then
  [[ "$(git -C "$project_dir" rev-parse "${commit}^{tree}")" == "$tree" ]] || {
    echo "ERROR: Provenance commit does not resolve to the recorded tree." >&2
    exit 3
  }
fi
if [[ -n "$public_key" ]]; then
  command -v cosign >/dev/null 2>&1 || { echo "ERROR: cosign is required for signature verification." >&2; exit 3; }
  [[ -f "${archive}.sig" ]] || { echo "ERROR: Signature is missing." >&2; exit 3; }
  [[ -f "${provenance}.sig" ]] || { echo "ERROR: Provenance signature is missing." >&2; exit 3; }
  cosign verify-blob --key "$public_key" --signature "${archive}.sig" "$archive"
  cosign verify-blob --key "$public_key" --signature "${provenance}.sig" "$provenance"
else
  echo "Checksum and provenance passed. Signatures were not checked because no public key was supplied."
fi
