#!/usr/bin/env bash
set -euo pipefail

usage() { echo "Usage: $0 --hypervisor virtualbox|vmware --arch amd64|arm64" >&2; exit 2; }
hypervisor=""; architecture=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --hypervisor) hypervisor="${2:-}"; shift 2 ;;
    --arch) architecture="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[[ "$hypervisor" == virtualbox || "$hypervisor" == vmware ]] || usage
[[ "$architecture" == amd64 || "$architecture" == arm64 ]] || usage

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "$(uname -m)" in x86_64) host_arch=amd64 ;; arm64|aarch64) host_arch=arm64 ;; *) host_arch=unsupported ;; esac
[[ "$host_arch" == "$architecture" ]] || {
  echo "BLOCKED: native $architecture build requires a $architecture host; detected $host_arch" >&2
  exit 4
}
command -v git >/dev/null && command -v packer >/dev/null || {
  echo "ERROR: git and Packer are required" >&2; exit 3;
}
if [[ "$hypervisor" == virtualbox ]]; then command -v VBoxManage >/dev/null || { echo "ERROR: VirtualBox is required" >&2; exit 3; }; fi
if [[ "$hypervisor" == vmware ]]; then command -v vmrun >/dev/null || { echo "ERROR: VMware Fusion/Workstation vmrun is required" >&2; exit 3; }; fi

git -C "$project_dir" diff --quiet && git -C "$project_dir" diff --cached --quiet || {
  echo "ERROR: appliance builds require a clean, committed worktree" >&2; exit 5;
}
commit="$(git -C "$project_dir" rev-parse HEAD)"
release="$(sed -n 's/^RELEASE_VERSION=//p' "$project_dir/.env.example" | head -n1)"
build_password="Ntp!9$(openssl rand -hex 16)"
build_password_hash="$(printf '%s' "$build_password" | openssl passwd -6 -stdin)"
build_dir="$project_dir/appliance/packer/build"
mkdir -p "$build_dir"
git -C "$project_dir" archive --format=tar.gz --prefix=nettap/ -o "$build_dir/nettap-source.tar.gz" "$commit"

cd "$project_dir/appliance/packer"
packer init .
packer fmt -check .
packer validate -var-file="${architecture}.pkrvars.hcl" -var="source_commit=$commit" -var="release_version=$release" \
  -var="build_password=$build_password" -var="build_password_hash=$build_password_hash" .
packer build -only="nettap-appliance-${architecture}.${hypervisor}-iso.target" \
  -var-file="${architecture}.pkrvars.hcl" -var="source_commit=$commit" -var="release_version=$release" \
  -var="build_password=$build_password" -var="build_password_hash=$build_password_hash" .
unset build_password build_password_hash
