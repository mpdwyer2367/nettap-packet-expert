#!/usr/bin/env bash
set -euo pipefail

[[ "${1:-}" == --phase && ( "${2:-}" == runtime || "${2:-}" == post-reboot ) && $# -eq 2 ]] || {
  echo "Usage: $0 --phase runtime|post-reboot" >&2; exit 2;
}
phase="$2"; app=/opt/nettap/app; state=/var/lib/nettap/acceptance
mkdir -p "$state"; chmod 0700 "$state"
report="$state/${phase}-$(date -u +%Y%m%dT%H%M%SZ).txt"
exec > >(tee "$report") 2>&1

pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*"; exit 1; }
command -v tshark >/dev/null && pass "guest TShark installed" || fail "guest TShark missing"
systemctl is-active --quiet docker && pass "Docker active" || fail "Docker inactive"
systemctl is-enabled --quiet nettap-appliance.service && pass "boot persistence enabled" || fail "boot persistence disabled"

hostname="$(sed -n 's/^APPLIANCE_HOSTNAME=//p' "$app/.env")"
port="$(sed -n 's/^HTTPS_PORT=//p' "$app/.env")"
token="$(sed -n 's/^EVIDENCE_API_TOKEN=//p' "$app/.env")"
base="https://${hostname}:${port}"
curl --fail --silent --show-error --cacert "$app/config/tls/tls.crt" \
  --resolve "${hostname}:${port}:127.0.0.1" "$base/health" >/dev/null && pass "Open WebUI HTTPS health"
curl --fail --silent --show-error --cacert "$app/config/tls/tls.crt" \
  --resolve "${hostname}:${port}:127.0.0.1" "$base/evidence/health" >/dev/null && pass "evidence HTTPS health"

if [[ "$phase" == post-reboot ]]; then
  [[ -f "$state/runtime-complete" ]] || fail "runtime phase evidence missing"
  pass "application survived reboot"
  exit 0
fi

pcap="$state/synthetic.pcap"
python3 - "$pcap" <<'PY'
import struct, sys
ethernet=bytes.fromhex('00112233445566778899aabb0800')
ipv4=struct.pack('!BBHHHBBH4s4s',0x45,0,40,1,0,64,6,0,bytes([192,0,2,10]),bytes([198,51,100,20]))
tcp=struct.pack('!HHIIBBHHH',49152,443,1,0,5<<4,2,65535,0,0)
packet=ethernet+ipv4+tcp
open(sys.argv[1],'wb').write(struct.pack('<IHHIIII',0xA1B2C3D4,2,4,0,0,65535,1)+struct.pack('<IIII',1786000000,250000,len(packet),len(packet))+packet)
PY
curl_common=(--fail --silent --show-error --cacert "$app/config/tls/tls.crt" --resolve "${hostname}:${port}:127.0.0.1" -H "Authorization: Bearer $token")
case_json="$(curl "${curl_common[@]}" -H 'Content-Type: application/json' -d '{"title":"OVA acceptance","objective":"Verify deterministic packet workflow","environment":"synthetic authorized lab"}' "$base/evidence/v1/cases")"
case_id="$(printf '%s' "$case_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
evidence_json="$(curl "${curl_common[@]}" --data-binary "@$pcap" "$base/evidence/v1/cases/$case_id/evidence?source_type=pcap&filename=synthetic.pcap")"
printf '%s' "$evidence_json" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["parser_name"] == "nettap-tshark-metadata", d' && pass "PCAP decoded by TShark"
pcapng="$state/synthetic.pcapng"
editcap -F pcapng "$pcap" "$pcapng"
pcapng_json="$(curl "${curl_common[@]}" --data-binary "@$pcapng" "$base/evidence/v1/cases/$case_id/evidence?source_type=pcapng&filename=synthetic.pcapng")"
printf '%s' "$pcapng_json" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["parser_name"] == "nettap-tshark-metadata", d' && pass "PCAPNG decoded by TShark"
curl "${curl_common[@]}" -X POST -d '' "$base/evidence/v1/cases/$case_id/analyze" >/dev/null && pass "deterministic analysis"
context_json="$(curl "${curl_common[@]}" "$base/evidence/v1/cases/$case_id/context")"
curl "${curl_common[@]}" "$base/evidence/v1/cases/$case_id/report.pdf" -o "$state/report.pdf"
head -c 8 "$state/report.pdf" | grep -aq '%PDF-1.4' && pass "PDF report generated" || fail "invalid PDF report"

model="$(sed -n 's/^NETTAP_AI_MODEL=//p' "$app/.env")"
evidence_id="$(printf '%s' "$evidence_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
prompt="Authorized synthetic evidence context: ${context_json}. In one short sentence, state the observed endpoints and cite evidence ID ${evidence_id} exactly."
timeout 300 docker compose --project-directory "$app" --env-file "$app/.env" -f "$app/compose.yaml" -f "$app/compose.production.yaml" \
  exec -T ollama ollama run "$model" "$prompt" >"$state/model-response.txt"
[[ -s "$state/model-response.txt" ]] || fail "local model returned no text"
grep -Fq "$evidence_id" "$state/model-response.txt" && pass "local model cited evidence" || fail "local model omitted required evidence citation"
touch "$state/runtime-complete"
pass "runtime acceptance complete; reboot guest and run: sudo nettapctl acceptance --phase post-reboot"
