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
tree="$(git -C "$project_dir" rev-parse 'HEAD^{tree}')"
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
runtime_macos="${evidence_dir}/runtime-macos.txt"
runtime_windows="${evidence_dir}/runtime-windows.txt"
package_name=""
package_sha256=""
if [[ -s "$runtime_macos" ]]; then
  package_name="$(sed -n 's/^Package: //p' "$runtime_macos")"
  package_sha256="$(sed -n 's/^Package SHA256: //p' "$runtime_macos")"
fi
if [[ "$package_name" != "nettap-ai-suite-${version}-source.tar.gz" || \
      ! "$package_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "INVALID: runtime-macos.txt does not identify the exact candidate package and SHA-256."
  missing=true
fi
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
  grep -Fqx "Tree: $tree" "${evidence_dir}/${file}" || {
    echo "INVALID: $file does not identify Tree: $tree"
    missing=true
  }
  if [[ -n "$package_name" ]]; then
    grep -Fqx "Package: $package_name" "${evidence_dir}/${file}" || {
      echo "INVALID: $file does not identify Package: $package_name"
      missing=true
    }
  fi
  if [[ -n "$package_sha256" ]]; then
    grep -Fqx "Package SHA256: $package_sha256" "${evidence_dir}/${file}" || {
      echo "INVALID: $file does not identify Package SHA256: $package_sha256"
      missing=true
    }
  fi
  grep -Fqx 'Result: PASS' "${evidence_dir}/${file}" || {
    echo "INVALID: $file does not contain Result: PASS"
    missing=true
  }
done
if [[ -s "$runtime_macos" && -s "$runtime_windows" ]] && \
  ! "${project_dir}/tests/compare-platform-acceptance.sh" "$runtime_macos" "$runtime_windows"; then
  echo "INVALID: macOS and Windows/WSL2 runtime records do not identify the same signed package."
  missing=true
fi
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
