#!/usr/bin/env bash
set -euo pipefail

[[ $# -eq 2 ]] || {
  echo "Usage: ./tests/compare-platform-acceptance.sh <macos-summary.txt> <windows-wsl2-summary.txt>" >&2
  exit 2
}
macos="$1"
windows="$2"
[[ -f "$macos" && -f "$windows" ]] || { echo "ERROR: Both acceptance summaries are required." >&2; exit 3; }

grep -Fqx 'Result: PASS' "$macos"
grep -Fqx 'Platform: macos' "$macos"
grep -Fqx 'Result: PASS' "$windows"
grep -Fqx 'Platform: windows-wsl2' "$windows"

field() {
  sed -n "s/^$1: //p" "$2"
}
for identity in Version Commit Tree Package 'Package SHA256' 'Base model ID' 'NetTAP AI model ID' \
  'Embedding aggregate SHA256' 'Provisioning fingerprint'; do
  mac_value="$(field "$identity" "$macos")"
  windows_value="$(field "$identity" "$windows")"
  [[ -n "$mac_value" && "$mac_value" == "$windows_value" ]] || {
    echo "FAIL: Platform evidence differs for $identity." >&2
    exit 4
  }
done
grep -Fqx 'Signature verification: PASS' "$macos"
grep -Fqx 'Signature verification: PASS' "$windows"
echo "PASS: macOS and Windows/WSL2 used the identical signed source, model, embedding, and provisioning identities."
