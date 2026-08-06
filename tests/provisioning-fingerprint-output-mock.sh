#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/common.sh
source "${project_dir}/scripts/common.sh"

expected="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
other="abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

actual="$(printf '%s\n' \
  'Container nettap-provisioner Creating' \
  "$expected" \
  'What is next: Debug this Compose error with Gordon' | extract_provisioning_fingerprint)"
[[ "$actual" == "$expected" ]]

actual="$(printf '%s\r\n%s\n' "$expected" "$expected" | extract_provisioning_fingerprint)"
[[ "$actual" == "$expected" ]]

if printf '%s\n' 'no fingerprint here' | extract_provisioning_fingerprint >/dev/null; then
  echo 'ERROR: Missing fingerprint output was accepted.' >&2
  exit 1
fi

if printf '%s\n' "$expected" "$other" | extract_provisioning_fingerprint >/dev/null 2>&1; then
  echo 'ERROR: Conflicting fingerprint output was accepted.' >&2
  exit 1
fi

echo 'PASS: provisioning fingerprint extraction ignores helper output and rejects ambiguous values.'
