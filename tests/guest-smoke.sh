#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
full=false
if [[ "${1:-}" == --full ]]; then full=true; shift; fi
output="${1:-/var/lib/nettap/reports/guest-smoke-$(date -u +%Y%m%dT%H%M%SZ).md}"
[[ "$(id -u)" -eq 0 ]] || { echo "ERROR: guest smoke test must run as root." >&2; exit 3; }
install -d -m 0750 "$(dirname "$output")"

test -s /etc/machine-id
test -s /etc/ssh/ssh_host_ed25519_key.pub
if id packer >/dev/null 2>&1; then echo "ERROR: Packer account was not removed." >&2; exit 4; fi
test "$(stat -c '%a' /etc/nettap/nettap.env)" = 600
if grep -Eq '=(GENERATE_ON_FIRST_START|Password!)$' /etc/nettap/nettap.env; then
  echo "ERROR: Bootstrap placeholder or shared local password remains." >&2
  exit 4
fi
test -s /etc/nettap/tls/tls.crt
test -s /etc/nettap/tls/tls.key
ufw status | grep -Fq 'Status: active'
grep -Fq 'nettap_configuration' /etc/audit/rules.d/nettap.rules
docker network inspect nettap-packet-expert_backend --format '{{.Internal}}' | grep -Fqx true
docker network inspect nettap-packet-expert_user-access --format '{{.Internal}}' | grep -Fqx true

"${project_dir}/appliance/runtime.sh" status
"${project_dir}/scripts/healthcheck.sh"
"${project_dir}/tests/evidence-runtime-e2e.sh" --production
"${project_dir}/tests/packet-upload-e2e.sh" --production

state_file=/var/lib/nettap/open-webui/nettap-provisioning-state.json
python3 - "$state_file" <<'PY'
import json, sys
state = json.load(open(sys.argv[1], encoding="utf-8"))
assert state["runtime_model"] == "nettap-ai:0.4.0-rc.1"
assert {item["id"] for item in state["assistants"]} == {
    "nettap-network-visibility", "nettap-packet-expert"
}
assert len(state["fingerprint"]) == 64
assert state["offline_rag"]["result"] == "PASS"
PY

inference_output="$(mktemp "${TMPDIR:-/tmp}/nettap-inference.XXXXXX")"
cleanup() { rm -f "$inference_output"; }
trap cleanup EXIT
timeout 300 "${project_dir}/appliance/runtime.sh" compose exec -T ollama \
  ollama run nettap-ai:0.4.0-rc.1 'Reply with exactly: NETTAP_ACCEPTED' > "$inference_output"
grep -Fq 'NETTAP_ACCEPTED' "$inference_output"

recovery_result="NOT RUN"
if [[ "$full" == true ]]; then
  recovery_dir="$(mktemp -d /var/lib/nettap/state/recovery-smoke.XXXXXX)"
  recovery_prefix="nettap-smoke-$(date -u +%H%M%S)"
  recovery_cleanup() {
    docker volume rm \
      "${recovery_prefix}-ollama-data" \
      "${recovery_prefix}-open-webui-data" \
      "${recovery_prefix}-evidence-data" >/dev/null 2>&1 || true
    case "$recovery_dir" in /var/lib/nettap/state/recovery-smoke.*) rm -rf "$recovery_dir" ;; esac
  }
  trap 'cleanup; recovery_cleanup' EXIT
  age-keygen --output "${recovery_dir}/identity.txt" >/dev/null
  recipient="$(age-keygen -y "${recovery_dir}/identity.txt")"
  encrypted_backup="${recovery_dir}/recovery.tar.age"
  "${project_dir}/scripts/appliance-backup.sh" --recipient "$recipient" --output "$encrypted_backup"
  "${project_dir}/scripts/appliance-restore.sh" "$encrypted_backup" \
    --identity "${recovery_dir}/identity.txt" --target-prefix "$recovery_prefix"
  backup_image="$(sed -n 's/^BACKUP_IMAGE=//p' /etc/nettap/nettap.env)"
  source_webui_sha="$(sha256sum /var/lib/nettap/open-webui/webui.db | awk '{print $1}')"
  restored_webui_sha="$(docker run --rm --network none \
    -v "${recovery_prefix}-open-webui-data:/restore:ro" "$backup_image" \
    sha256sum /restore/webui.db | awk '{print $1}')"
  [[ "$source_webui_sha" == "$restored_webui_sha" ]]
  source_evidence_sha="$(sha256sum /var/lib/nettap/evidence/nettap-evidence.db | awk '{print $1}')"
  restored_evidence_sha="$(docker run --rm --network none \
    -v "${recovery_prefix}-evidence-data:/restore:ro" "$backup_image" \
    sha256sum /restore/nettap-evidence.db | awk '{print $1}')"
  [[ "$source_evidence_sha" == "$restored_evidence_sha" ]]
  recovery_result=PASS
  recovery_cleanup
  trap cleanup EXIT
  "${project_dir}/scripts/healthcheck.sh"
fi

{
  printf '# NetTAP guest smoke acceptance\n\n'
  printf 'Overall result: PASS\n\n'
  printf -- '- Recorded UTC: %s\n' "$(date -u +%FT%TZ)"
  # shellcheck disable=SC2016 # Backticks are Markdown, not shell expansion.
  printf -- '- Machine ID: `%s`\n' "$(cat /etc/machine-id)"
  # shellcheck disable=SC2016 # Backticks are Markdown, not shell expansion.
  printf -- '- Architecture: `%s`\n' "$(uname -m)"
  # shellcheck disable=SC2016 # Backticks are Markdown, not shell expansion.
  printf -- '- Model contract: `nettap-ai:0.4.0-rc.1`\n'
  printf -- '- PCAP and PCAPNG decode: PASS\n'
  printf -- '- Raw payload excluded from context: PASS\n'
  printf -- '- Both managed assistants selected: PASS\n'
  printf -- '- Bounded inference: PASS\n'
  printf -- '- Runtime networks internal/offline: PASS\n'
  printf -- '- Encrypted backup and isolated restore continuity: %s\n' "$recovery_result"
} > "$output"
chmod 0640 "$output"
echo "Guest smoke passed: $output"
