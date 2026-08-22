#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
packer_dir="${project_dir}/appliance/packer"
target="${1:-}"

usage() {
  echo "Usage: ./scripts/build-ova.sh {virtualbox-amd64|vmware-amd64|virtualbox-arm64|vmware-arm64}" >&2
  exit 2
}
[[ $# -eq 1 ]] || usage
case "$target" in
  virtualbox-amd64) hypervisor=virtualbox; architecture=amd64 ;;
  vmware-amd64) hypervisor=vmware; architecture=amd64 ;;
  virtualbox-arm64) hypervisor=virtualbox; architecture=arm64 ;;
  vmware-arm64) hypervisor=vmware; architecture=arm64 ;;
  *) usage ;;
esac

for command in git packer; do
  command -v "$command" >/dev/null 2>&1 || { echo "ERROR: Required command not found: $command" >&2; exit 3; }
done
[[ "$(packer --version | awk 'NR == 1 {print $2}')" == v1.15.4 ]] || {
  echo "ERROR: Packer v1.15.4 is required." >&2
  exit 3
}
[[ -z "$(git -C "$project_dir" status --porcelain)" ]] || {
  echo "ERROR: OVA builds require a clean Git worktree." >&2
  exit 4
}

host_arch="$(uname -m)"
case "$architecture:$host_arch" in
  amd64:x86_64|arm64:arm64|arm64:aarch64) ;;
  *) echo "ERROR: $target must build on matching native hardware; host is $host_arch." >&2; exit 4 ;;
esac
if [[ "$hypervisor" == virtualbox ]]; then
  command -v VBoxManage >/dev/null 2>&1 || { echo "ERROR: VBoxManage is required." >&2; exit 3; }
else
  command -v vmrun >/dev/null 2>&1 || { echo "ERROR: VMware vmrun is required." >&2; exit 3; }
  command -v ovftool >/dev/null 2>&1 || { echo "ERROR: VMware ovftool is required for OVA export." >&2; exit 3; }
fi

release_version="$(sed -n 's/^RELEASE_VERSION=//p' "${project_dir}/.env.example")"
source_commit="$(git -C "$project_dir" rev-parse HEAD)"
source_tree="$(git -C "$project_dir" rev-parse 'HEAD^{tree}')"
work_dir="${project_dir}/.packer/${target}"
output_dir="${project_dir}/dist/packer/${target}"
evidence_dir="${project_dir}/dist/evidence/${target}"
archive="${work_dir}/nettap-source.tar.gz"

[[ ! -e "$output_dir" ]] || { echo "ERROR: Build output already exists: $output_dir" >&2; exit 4; }
install -d "$work_dir" "$output_dir" "$evidence_dir"
git -C "$project_dir" archive --format=tar.gz -o "$archive" HEAD
archive_sha="$(shasum -a 256 "$archive" | awk '{print $1}')"

common_vars=(
  -var "architecture=${architecture}"
  -var "hypervisor=${hypervisor}"
  -var "release_version=${release_version}"
  -var "source_commit=${source_commit}"
  -var "source_tree=${source_tree}"
  -var "source_archive=${archive}"
  -var "source_archive_sha256=${archive_sha}"
  -var "output_directory=${output_dir}"
  -var "evidence_directory=${evidence_dir}"
)

packer init "$packer_dir"
packer validate "${common_vars[@]}" "$packer_dir"
packer build -only="nettap-appliance.${hypervisor}-iso.nettap" "${common_vars[@]}" "$packer_dir"

artifact_stem="nettap-ai-${release_version}-${hypervisor}-${architecture}"
artifact="$(find "$output_dir" -type f -name '*.ova' -print -quit)"
[[ -n "$artifact" ]] || { echo "ERROR: Packer did not produce an OVA." >&2; exit 8; }
canonical_artifact="${project_dir}/dist/${artifact_stem}.ova"
cp "$artifact" "$canonical_artifact"
shasum -a 256 "$canonical_artifact" > "${canonical_artifact}.sha256"
echo "OVA candidate: $canonical_artifact"
echo "Build evidence: $evidence_dir"
echo "The candidate is not releasable until matching-hardware import acceptance passes."
