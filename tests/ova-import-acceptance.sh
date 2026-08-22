#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="" ova="" evidence_dir="" guest_report="" cleanup_vm=false confirm=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) target="${2:-}"; shift 2 ;;
    --ova) ova="${2:-}"; shift 2 ;;
    --evidence-dir) evidence_dir="${2:-}"; shift 2 ;;
    --guest-report) guest_report="${2:-}"; shift 2 ;;
    --cleanup) cleanup_vm=true; shift ;;
    --confirm) confirm=true; shift ;;
    *) echo "Usage: ova-import-acceptance.sh --target <hypervisor-arch> --ova <file> --evidence-dir <dir> [--guest-report <path>] [--cleanup] --confirm" >&2; exit 2 ;;
  esac
done
[[ "$confirm" == true && -f "$ova" && -n "$evidence_dir" ]] || { echo "ERROR: Missing required acceptance argument." >&2; exit 2; }
case "$target" in
  virtualbox-amd64) hypervisor=virtualbox; architecture=amd64 ;;
  vmware-amd64) hypervisor=vmware; architecture=amd64 ;;
  virtualbox-arm64) hypervisor=virtualbox; architecture=arm64 ;;
  vmware-arm64) hypervisor=vmware; architecture=arm64 ;;
  *) echo "ERROR: Invalid target: $target" >&2; exit 2 ;;
esac
host_arch="$(uname -m)"
case "$architecture:$host_arch" in amd64:x86_64|arm64:arm64|arm64:aarch64) ;; *) echo "ERROR: Matching native hardware is required." >&2; exit 4 ;; esac
install -d "$evidence_dir"
python3 "${project_dir}/tests/inspect_ova.py" "$ova" | tee "${evidence_dir}/ova-metadata.txt"
shasum -a 256 "$ova" > "${evidence_dir}/ova.sha256"

suffix="$(date -u +%Y%m%d%H%M%S)-$$"
vm_name="nettap-accept-${suffix}"
public_url=""
ssh_host=""
ssh_port=""
tls_target=""
vmware_dir=""

wait_for_https() {
  for _ in $(seq 1 120); do
    if curl --insecure --fail --silent --show-error --max-time 10 "${public_url}/health" >/dev/null 2>&1; then return 0; fi
    sleep 5
  done
  echo "ERROR: Appliance HTTPS did not become healthy within ten minutes." >&2
  return 8
}

destroy_vm() {
  if [[ "$hypervisor" == virtualbox ]]; then
    VBoxManage controlvm "$vm_name" poweroff >/dev/null 2>&1 || true
    VBoxManage unregistervm "$vm_name" --delete >/dev/null 2>&1 || true
  elif [[ -n "$vmware_dir" ]]; then
    vmx="${vmware_dir}/${vm_name}.vmx"
    vmrun stop "$vmx" hard >/dev/null 2>&1 || true
    case "$vmware_dir" in */nettap-accept-*) rm -rf "$vmware_dir" ;; esac
  fi
}
trap 'if [[ "$cleanup_vm" == true ]]; then destroy_vm; fi' EXIT

if [[ "$hypervisor" == virtualbox ]]; then
  command -v VBoxManage >/dev/null 2>&1 || { echo "ERROR: VBoxManage is required." >&2; exit 3; }
  https_port=$((18443 + ($$ % 1000)))
  ssh_port=$((22022 + ($$ % 1000)))
  VBoxManage import "$ova" --vsys 0 --vmname "$vm_name" | tee "${evidence_dir}/import.log"
  VBoxManage modifyvm "$vm_name" \
    --natpf1 "nettap-https,tcp,127.0.0.1,${https_port},,8443" \
    --natpf1 "nettap-ssh,tcp,127.0.0.1,${ssh_port},,22"
  VBoxManage showvminfo "$vm_name" --machinereadable > "${evidence_dir}/hypervisor-info.txt"
  VBoxManage startvm "$vm_name" --type headless | tee "${evidence_dir}/start.log"
  public_url="https://127.0.0.1:${https_port}"
  ssh_host=127.0.0.1
  tls_target="127.0.0.1:${https_port}"
else
  command -v ovftool >/dev/null 2>&1 || { echo "ERROR: ovftool is required." >&2; exit 3; }
  command -v vmrun >/dev/null 2>&1 || { echo "ERROR: vmrun is required." >&2; exit 3; }
  vmware_dir="${evidence_dir}/${vm_name}"
  install -d "$vmware_dir"
  ovftool --name="$vm_name" "$ova" "${vmware_dir}/${vm_name}.vmx" | tee "${evidence_dir}/import.log"
  vmx="${vmware_dir}/${vm_name}.vmx"
  vmrun start "$vmx" nogui
  guest_ip="$(vmrun getGuestIPAddress "$vmx" -wait)"
  public_url="https://${guest_ip}:8443"
  ssh_host="$guest_ip"
  ssh_port=22
  tls_target="${guest_ip}:8443"
  vmrun list > "${evidence_dir}/hypervisor-info.txt"
fi

wait_for_https
curl --insecure --fail --silent --show-error "${public_url}/health" > "${evidence_dir}/health-before-reboot.json"
for _ in $(seq 1 12); do
  if ssh-keyscan -T 10 -p "$ssh_port" "$ssh_host" > "${evidence_dir}/ssh-host-key.txt" 2>/dev/null && \
    [[ -s "${evidence_dir}/ssh-host-key.txt" ]]; then break; fi
  sleep 5
done
[[ -s "${evidence_dir}/ssh-host-key.txt" ]] || { echo "ERROR: SSH did not become reachable." >&2; exit 8; }
tls_before="$(echo | openssl s_client -connect "$tls_target" 2>/dev/null | openssl x509 -noout -fingerprint -sha256 2>/dev/null || true)"

if [[ "$hypervisor" == virtualbox ]]; then
  VBoxManage controlvm "$vm_name" acpipowerbutton
  for _ in $(seq 1 60); do
    state="$(VBoxManage showvminfo "$vm_name" --machinereadable | sed -n 's/^VMState="\(.*\)"/\1/p')"
    [[ "$state" == poweroff ]] && break
    sleep 5
  done
  [[ "${state:-}" == poweroff ]] || { echo "ERROR: Guest did not shut down cleanly." >&2; exit 8; }
  VBoxManage startvm "$vm_name" --type headless >/dev/null
else
  vmrun stop "$vmx" soft
  vmrun start "$vmx" nogui
  guest_ip="$(vmrun getGuestIPAddress "$vmx" -wait)"
  public_url="https://${guest_ip}:8443"
fi
wait_for_https
curl --insecure --fail --silent --show-error "${public_url}/health" > "${evidence_dir}/health-after-reboot.json"

overall=INCOMPLETE
if [[ -n "$guest_report" ]]; then
  echo "Waiting up to 60 minutes for guest report: $guest_report"
  for _ in $(seq 1 120); do [[ -s "$guest_report" ]] && break; sleep 30; done
  [[ -s "$guest_report" ]] || { echo "ERROR: Guest report was not supplied." >&2; exit 9; }
  grep -Fqx 'Overall result: PASS' "$guest_report"
  grep -Fq 'Encrypted backup and isolated restore continuity: PASS' "$guest_report"
  cp "$guest_report" "${evidence_dir}/guest-smoke.md"
  overall=PASS
fi

report="${evidence_dir}/acceptance-report.md"
{
  printf '# OVA import acceptance — %s\n\n' "$target"
  printf 'Overall result: %s\n\n' "$overall"
  printf -- '- Recorded UTC: %s\n' "$(date -u +%FT%TZ)"
  # shellcheck disable=SC2016 # Backticks are Markdown, not shell expansion.
  printf -- '- Artifact: `%s`\n' "$(basename "$ova")"
  # shellcheck disable=SC2016 # Backticks are Markdown, not shell expansion.
  printf -- '- Native host architecture: `%s`\n' "$host_arch"
  printf -- '- Hypervisor import: PASS\n'
  printf -- '- Evaluation CPU/RAM/disk/NIC metadata: PASS\n'
  printf -- '- HTTPS first boot: PASS\n'
  printf -- '- SSH first boot: PASS\n'
  printf -- '- Persistence and service recovery after reboot: PASS\n'
  # shellcheck disable=SC2016 # Backticks are Markdown, not shell expansion.
  printf -- '- TLS fingerprint observed before reboot: `%s`\n' "${tls_before:-unavailable}"
  if [[ "$overall" == PASS ]]; then
    sed -n '/^- Model contract:/p;/^- PCAP and PCAPNG/p;/^- Raw payload/p;/^- Both managed/p;/^- Bounded inference/p;/^- Runtime networks/p;/^- Encrypted backup/p' "${evidence_dir}/guest-smoke.md"
  else
    printf -- '- Guest smoke, model, evidence, offline, and recovery gates: NOT RUN\n'
    # shellcheck disable=SC2016 # Backticks are Markdown, not shell expansion.
    printf '\nRun `sudo nettapctl guest-smoke --full`, copy its report to the host, and repeat with `--guest-report <path>`.\n'
  fi
} > "$report"

if [[ "$cleanup_vm" == true ]]; then destroy_vm; trap - EXIT; fi
echo "Acceptance report: $report"
[[ "$overall" == PASS ]] || exit 10
