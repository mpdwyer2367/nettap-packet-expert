#!/usr/bin/env bash
set -euo pipefail
archive="${1:-}"
public_key="${2:-}"
[[ -f "$archive" && -f "${archive}.sha256" ]] || {
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
if [[ -n "$public_key" ]]; then
  command -v cosign >/dev/null 2>&1 || { echo "ERROR: cosign is required for signature verification." >&2; exit 3; }
  [[ -f "${archive}.sig" ]] || { echo "ERROR: Signature is missing." >&2; exit 3; }
  cosign verify-blob --key "$public_key" --signature "${archive}.sig" "$archive"
else
  echo "Checksum passed. Signature was not checked because no public key was supplied."
fi
