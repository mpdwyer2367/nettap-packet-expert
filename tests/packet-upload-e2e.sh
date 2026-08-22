#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/common.sh
source "${project_dir}/scripts/common.sh"
[[ "${1:-}" == --production && $# -eq 1 ]] || { echo "Usage: ./tests/packet-upload-e2e.sh --production" >&2; exit 2; }
token="$(load_env_value EVIDENCE_API_TOKEN)"
command -v tshark >/dev/null 2>&1 || { echo "ERROR: TShark is required for appliance packet acceptance." >&2; exit 3; }
hostname="$(load_env_value APPLIANCE_HOSTNAME)"
port="$(load_env_value HTTPS_PORT)"
base_url="https://${hostname}:${port}/evidence"
curl_options=(--silent --show-error --fail --cacert "${project_dir}/config/tls/tls.crt" --resolve "${hostname}:${port}:127.0.0.1")
temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/nettap-packet-e2e.XXXXXX")"
cleanup() {
  case "$temporary_dir" in */nettap-packet-e2e.*) rm -rf "$temporary_dir" ;; esac
  unset token
}
trap cleanup EXIT
python3 "${project_dir}/tests/generate-packet-fixtures.py" "$temporary_dir"
for fixture in synthetic.pcap synthetic.pcapng; do
  tshark -r "${temporary_dir}/${fixture}" -T fields -e frame.number | grep -Eq '^[0-9]+$'
done

case_json="$(curl "${curl_options[@]}" \
  -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' \
  --data '{"title":"Packet format acceptance","objective":"Verify PCAP and PCAPNG decoding","environment":"Synthetic Ethernet fixture"}' \
  "${base_url}/v1/cases")"
case_id="$(printf '%s' "$case_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
metadata="$(python3 -c 'import base64,json; print(base64.urlsafe_b64encode(json.dumps({"source_timezone":"UTC","clock_sync_status":"synthetic","observation_point":"ova-acceptance","chain_of_custody":"generated-fixture","capture_drops":0,"truncation":False},separators=(",",":")).encode()).decode().rstrip("="))')"

for fixture in synthetic.pcap synthetic.pcapng; do
  digest="$(sha256_file "${temporary_dir}/${fixture}" | awk '{print $1}')"
  response="${temporary_dir}/${fixture}.json"
  curl "${curl_options[@]}" \
    -H "Authorization: Bearer ${token}" -H 'Content-Type: application/octet-stream' \
    -H "X-Content-SHA256: ${digest}" -H "X-NetTAP-Metadata: ${metadata}" \
    --data-binary "@${temporary_dir}/${fixture}" \
    "${base_url}/v1/cases/${case_id}/evidence?source_type=pcap&filename=${fixture}" > "$response"
  python3 - "$response" "$digest" <<'PY'
import json, sys
value = json.load(open(sys.argv[1], encoding="utf-8"))
assert value["sha256"] == sys.argv[2]
assert value["record_count"] >= 1
PY
done

analysis="${temporary_dir}/analysis.json"
context="${temporary_dir}/context.json"
curl "${curl_options[@]}" -X POST -H "Authorization: Bearer ${token}" "${base_url}/v1/cases/${case_id}/analyze" > "$analysis"
curl "${curl_options[@]}" -H "Authorization: Bearer ${token}" "${base_url}/v1/cases/${case_id}/context" > "$context"
python3 - "$analysis" "$context" <<'PY'
import json, sys
analysis = json.load(open(sys.argv[1], encoding="utf-8"))
context = json.load(open(sys.argv[2], encoding="utf-8"))
assert analysis["latest_analysis"]["summary"]["observation_count"] >= 2
assert context["raw_evidence_included"] is False
serialized = json.dumps(context).lower()
assert "4e544150" not in serialized
assert "raw bytes" not in serialized
PY
echo "PASS: PCAP and PCAPNG decoded locally without raw payload in model context"
