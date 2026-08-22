#!/usr/bin/env bash
set -euo pipefail

architecture=""; hypervisor=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch) architecture="${2:-}"; shift 2 ;;
    --hypervisor) hypervisor="${2:-}"; shift 2 ;;
    *) echo "Usage: $0 --arch amd64|arm64 --hypervisor virtualbox|vmware" >&2; exit 2 ;;
  esac
done
[[ "$architecture" == amd64 || "$architecture" == arm64 ]] || { echo "ERROR: invalid architecture" >&2; exit 2; }
[[ "$hypervisor" == virtualbox || "$hypervisor" == vmware ]] || { echo "ERROR: invalid hypervisor" >&2; exit 2; }
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="$project_dir/appliance/packer/output"
bundle="$output/bundle-$architecture"
mkdir -p "$bundle"

if [[ "$hypervisor" == virtualbox ]]; then
  virtualbox_ova="$(find "$output/virtualbox-$architecture" -maxdepth 1 -type f -name '*.ova' -print -quit 2>/dev/null || true)"
  [[ -n "$virtualbox_ova" ]] || { echo "ERROR: VirtualBox OVA is missing" >&2; exit 4; }
  cp "$virtualbox_ova" "$bundle/"
else
  vmx="$(find "$output/vmware-$architecture" -maxdepth 1 -type f -name '*.vmx' -print -quit 2>/dev/null || true)"
  [[ -n "$vmx" ]] || { echo "ERROR: VMware VMX is missing" >&2; exit 4; }
  command -v ovftool >/dev/null || { echo "BLOCKED: VMware OVA export requires ovftool" >&2; exit 4; }
  ovftool --acceptAllEulas --shaAlgorithm=SHA256 "$vmx" "$bundle/nettap-ai-${architecture}-vmware.ova"
fi

command -v syft >/dev/null || { echo "BLOCKED: SBOM generation requires syft" >&2; exit 4; }
for ova in "$bundle"/*.ova; do syft "$ova" -o spdx-json="${ova}.spdx.json"; done
(cd "$bundle" && sha256sum ./*.ova ./*.spdx.json > SHA256SUMS)
python3 "$project_dir/appliance/scripts/release_manifest.py" "$bundle"
if command -v cosign >/dev/null && [[ -n "${COSIGN_KEY:-}" ]]; then
  cosign sign-blob --key "$COSIGN_KEY" --bundle "$bundle/release-manifest.sigstore.json" "$bundle/release-manifest.json"
else
  echo "NOT EXECUTED: signing requires cosign and COSIGN_KEY" >&2
fi
echo "Bundle staged at $bundle"
