#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for file in \
  appliance/compose.appliance.yaml \
  appliance/firstboot.sh \
  appliance/runtime.sh \
  appliance/generate-sbom.py \
  appliance/packer/nettap.pkr.hcl \
  appliance/packer/http/meta-data \
  appliance/packer/http/user-data \
  appliance/packer/scripts/install-appliance.sh \
  appliance/packer/scripts/seal-appliance.sh \
  appliance/systemd/nettap-firstboot.service \
  appliance/systemd/nettap.service \
  scripts/nettapctl scripts/build-ova.sh scripts/package-appliance-bundle.sh \
  scripts/appliance-backup.sh scripts/appliance-restore.sh \
  scripts/verify-appliance-bundle.sh tests/guest-smoke.sh tests/packet-upload-e2e.sh \
  tests/inspect_ova.py tests/ova-import-acceptance.sh; do
  test -s "${project_dir}/${file}"
done

grep -Fq 'nettap-ai:0.4.0-rc.1' "${project_dir}/appliance/packer/scripts/install-appliance.sh"
grep -Fq 'e907d92eeec9df64163a7e454cbc8d7755e8ddc7ed42f99dbc80c40f1a138433' "${project_dir}/appliance/packer/nettap.pkr.hcl"
grep -Fq '9a6ce6d7e66c8abed24d24944570a495caca80b3b0007df02818e13829f27f32' "${project_dir}/appliance/packer/nettap.pkr.hcl"
grep -Fq 'format               = "ova"' "${project_dir}/appliance/packer/nettap.pkr.hcl"
grep -Fq 'NETTAP_APT_SNAPSHOT' "${project_dir}/appliance/packer/scripts/install-appliance.sh"
grep -Fq 'ConditionPathExists=!/var/lib/nettap/state/firstboot-complete' "${project_dir}/appliance/systemd/nettap-firstboot.service"
grep -Fq 'driver_opts:' "${project_dir}/appliance/compose.appliance.yaml"
grep -Fq 'internal: true' "${project_dir}/compose.yaml"

python3 -m py_compile \
  "${project_dir}/appliance/generate-sbom.py" \
  "${project_dir}/tests/generate-packet-fixtures.py" \
  "${project_dir}/tests/inspect_ova.py"
temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/nettap-packet-fixtures.XXXXXX")"
cleanup() { case "$temporary_dir" in */nettap-packet-fixtures.*) rm -rf "$temporary_dir" ;; esac; }
trap cleanup EXIT
python3 "${project_dir}/tests/generate-packet-fixtures.py" "$temporary_dir"
test "$(wc -c < "${temporary_dir}/synthetic.pcap")" -gt 64
test "$(wc -c < "${temporary_dir}/synthetic.pcapng")" -gt 80

for script in \
  appliance/firstboot.sh appliance/runtime.sh \
  appliance/packer/scripts/install-appliance.sh appliance/packer/scripts/seal-appliance.sh \
  scripts/nettapctl scripts/build-ova.sh scripts/package-appliance-bundle.sh \
  scripts/appliance-backup.sh scripts/appliance-restore.sh \
  scripts/verify-appliance-bundle.sh tests/guest-smoke.sh tests/packet-upload-e2e.sh \
  tests/ova-import-acceptance.sh; do
  bash -n "${project_dir}/${script}"
done

if command -v packer >/dev/null 2>&1; then
  packer fmt -check "${project_dir}/appliance/packer"
  packer validate -syntax-only "${project_dir}/appliance/packer"
else
  echo "WARNING: packer unavailable; CI must run the mandatory Packer validation gate." >&2
fi

if grep -RInE '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})' \
  "${project_dir}/appliance"; then
  echo "ERROR: Possible secret in appliance sources." >&2
  exit 1
fi
echo "Appliance source checks passed."
