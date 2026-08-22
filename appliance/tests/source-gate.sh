#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

find "$project_dir/appliance" "$project_dir/scripts" -type f -name '*.sh' -print0 |
  while IFS= read -r -d '' file; do bash -n "$file"; done
python3 -m compileall -q "$project_dir/appliance" "$project_dir/case_service"
python3 -m unittest -v \
  tests.test_case_service tests.test_evidence_filter tests.test_packet_decoder \
  appliance.tests.test_appliance_sources

if command -v packer >/dev/null; then
  test_password="Ntp!9$(openssl rand -hex 8)"
  test_password_hash="$(printf '%s' "$test_password" | openssl passwd -6 -stdin)"
  (cd "$project_dir/appliance/packer" && packer init . && packer fmt -check . && \
    packer validate -var="build_password=$test_password" -var="build_password_hash=$test_password_hash" -var-file=amd64.pkrvars.hcl . && \
    packer validate -var="build_password=$test_password" -var="build_password_hash=$test_password_hash" -var-file=arm64.pkrvars.hcl .)
  unset test_password test_password_hash
else
  [[ "${NETTAP_REQUIRE_PACKER:-0}" != 1 ]] || { echo "FAIL: Packer is required by this gate" >&2; exit 1; }
  echo "NOT EXECUTED: Packer HCL validation (packer unavailable)"
fi
echo "PASS: appliance source gate"
