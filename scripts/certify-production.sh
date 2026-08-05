#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
"${project_dir}/tests/static-checks.sh"
[[ -z "$(git -C "$project_dir" status --porcelain)" ]] || {
  echo "NOT CERTIFIED: Git worktree is not clean." >&2
  exit 30
}
commit="$(git -C "$project_dir" rev-parse HEAD)"
version="$(sed -n 's/^RELEASE_VERSION=//p' "${project_dir}/.env.example" | tail -n 1)"
evidence_dir="${project_dir}/reports/production/private"
required=(
  runtime-macos.txt
  runtime-windows.txt
  vulnerability-scan-attestation.txt
  penetration-test-approval.txt
  legal-release-approval.txt
  support-readiness-approval.txt
  signed-acceptance.txt
)
missing=false
for file in "${required[@]}"; do
  if [[ ! -s "${evidence_dir}/${file}" ]]; then
    echo "PENDING: ${evidence_dir}/${file}"
    missing=true
    continue
  fi
  grep -Fqx "Version: $version" "${evidence_dir}/${file}" || {
    echo "INVALID: $file does not identify Version: $version"
    missing=true
  }
  grep -Fqx "Commit: $commit" "${evidence_dir}/${file}" || {
    echo "INVALID: $file does not identify Commit: $commit"
    missing=true
  }
  grep -Fqx 'Result: PASS' "${evidence_dir}/${file}" || {
    echo "INVALID: $file does not contain Result: PASS"
    missing=true
  }
done
if [[ -s "${evidence_dir}/signed-acceptance.txt" ]] && \
  ! grep -Fqx 'Signature verification: PASS' "${evidence_dir}/signed-acceptance.txt"; then
  echo "INVALID: signed-acceptance.txt does not contain Signature verification: PASS"
  missing=true
fi
if [[ "$missing" == true ]]; then
  echo "NOT CERTIFIED: source controls passed, but independent production evidence is incomplete." >&2
  exit 30
fi
echo "EVIDENCE FORMAT COMPLETE: an authorized release approver must still validate scope, signatures, exceptions, and protected attachments."
