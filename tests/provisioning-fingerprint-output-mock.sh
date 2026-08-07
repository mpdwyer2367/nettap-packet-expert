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

failure_dir="$(mktemp -d "${project_dir}/.tmp-provision-test.XXXXXX")"
trap 'rm -f "$failure_dir/stderr"; rmdir "$failure_dir"' EXIT
provisioning_fingerprint() { printf '%s\n' "$expected"; }
installed_provisioning_fingerprint() { printf '\n'; }
load_env_value() { printf '%s\n' 'test-password'; }
compose_local=(bash -c 'exit 42' provisioner-mock)
if provision_assistants local 2>"$failure_dir/stderr"; then
  echo 'ERROR: A failed assistant provisioner was accepted.' >&2
  exit 1
fi
grep -Fq 'Automatic assistant and offline RAG provisioning failed' "$failure_dir/stderr"
if grep -Fq 'state does not match the release fingerprint' "$failure_dir/stderr"; then
  echo 'ERROR: Provisioner failure was masked as a fingerprint mismatch.' >&2
  exit 1
fi

compose_local=(bash -c 'exit 11' provisioner-auth-mock)
if provision_assistants local 2>"$failure_dir/stderr"; then
  echo 'ERROR: A rejected administrator credential was accepted.' >&2
  exit 1
fi
grep -Fq 'stored bootstrap identity does not match this existing Open WebUI volume' "$failure_dir/stderr"
grep -Fq 'administrator email and password' "$failure_dir/stderr"
grep -Fq 'from an interactive terminal' "$failure_dir/stderr"

echo 'PASS: provisioning fingerprint extraction ignores helper output and rejects ambiguous values.'
echo 'PASS: assistant provisioner failures retain their actionable error instead of becoming fingerprint mismatches.'
echo 'PASS: existing-volume credential rejection requests the current administrator identity without resetting account data.'
