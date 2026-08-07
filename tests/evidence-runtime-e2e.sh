#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
# shellcheck source=scripts/common.sh
source "${project_dir}/scripts/common.sh"

mode="local"
if [[ "${1:-}" == "--production" && $# -eq 1 ]]; then
  mode="production"
elif [[ $# -ne 0 ]]; then
  echo "Usage: ./tests/evidence-runtime-e2e.sh [--production]" >&2
  exit 2
fi

for command_name in curl python3; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "ERROR: Required command not found: $command_name" >&2
    exit 3
  }
done
[[ -f "$env_file" ]] || { echo "ERROR: Missing .env; start the appliance first." >&2; exit 3; }

token="$(load_env_value EVIDENCE_API_TOKEN)"
[[ "$token" =~ ^[0-9a-f]{64}$ ]] || {
  echo "ERROR: Evidence API token is missing or invalid." >&2
  exit 3
}

curl_options=(--silent --show-error)
if [[ "$mode" == production ]]; then
  hostname="$(load_env_value APPLIANCE_HOSTNAME)"
  port="$(load_env_value HTTPS_PORT)"
  base_url="https://${hostname}:${port}/evidence"
  curl_options+=(--cacert "${project_dir}/config/tls/tls.crt" --resolve "${hostname}:${port}:127.0.0.1")
else
  evidence_port="${NETTAP_EVIDENCE_TEST_PORT:-$(load_env_value EVIDENCE_PORT)}"
  base_url="http://127.0.0.1:${evidence_port}"
fi

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/nettap-evidence-e2e.XXXXXX")"
cleanup() {
  case "$temporary_dir" in
    */nettap-evidence-e2e.*) rm -rf "$temporary_dir" ;;
  esac
  unset token
}
trap cleanup EXIT

health_file="${temporary_dir}/health.json"
curl "${curl_options[@]}" --fail "${base_url}/health" > "$health_file"
python3 - "$health_file" <<'PY'
import json
import sys
from pathlib import Path
value = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
assert value["status"] == "healthy"
assert value["service"] == "nettap-evidence"
PY

unauthorized_status="$(curl "${curl_options[@]}" --output /dev/null --write-out '%{http_code}' "${base_url}/v1/cases")"
[[ "$unauthorized_status" == 401 ]] || {
  echo "ERROR: Evidence API returned $unauthorized_status without authentication; expected 401." >&2
  exit 4
}

case_file="${temporary_dir}/case.json"
curl "${curl_options[@]}" --fail \
  -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' \
  --data '{"title":"Runtime acceptance case","objective":"Validate controlled IPFIX ingestion","environment":"Synthetic acceptance fixture"}' \
  "${base_url}/v1/cases" > "$case_file"
case_id="$(python3 - "$case_file" <<'PY'
import json
import sys
from pathlib import Path
value = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
assert value["status"] == "open"
print(value["id"])
PY
)"
[[ "$case_id" =~ ^[0-9a-f-]{36}$ ]] || { echo "ERROR: Case creation returned an invalid ID." >&2; exit 4; }

fixture="${project_dir}/tests/fixtures/normalized-ipfix.jsonl"
fixture_sha256="$(sha256_file "$fixture" | awk '{print $1}')"
metadata="$(python3 - <<'PY'
import base64
import json
value = {
    "source_timezone": "UTC",
    "clock_sync_status": "synchronized",
    "observation_point": "synthetic-runtime-test",
    "schema_version": "nettap.normalized.ipfix-flow/1.0",
    "chain_of_custody": "runtime-acceptance",
    "exporter_identity": "192.0.2.5",
    "sampling_rate": "1:100",
    "ipfix_template_status": "active",
    "capture_drops": 0,
    "truncation": False,
}
encoded = base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).decode()
print(encoded.rstrip("="))
PY
)"
upload_file="${temporary_dir}/upload.json"
curl "${curl_options[@]}" --fail \
  -H "Authorization: Bearer ${token}" -H 'Content-Type: application/octet-stream' \
  -H "X-Content-SHA256: ${fixture_sha256}" -H "X-NetTAP-Metadata: ${metadata}" \
  --data-binary "@${fixture}" \
  "${base_url}/v1/cases/${case_id}/evidence?source_type=ipfix&filename=normalized-ipfix.jsonl" > "$upload_file"

analysis_file="${temporary_dir}/analysis.json"
curl "${curl_options[@]}" --fail -X POST -H "Authorization: Bearer ${token}" \
  "${base_url}/v1/cases/${case_id}/analyze" > "$analysis_file"
context_file="${temporary_dir}/context.json"
curl "${curl_options[@]}" --fail -H "Authorization: Bearer ${token}" \
  "${base_url}/v1/cases/${case_id}/context" > "$context_file"
report_file="${temporary_dir}/report.md"
curl "${curl_options[@]}" --fail -H "Authorization: Bearer ${token}" \
  "${base_url}/v1/cases/${case_id}/report.md" > "$report_file"

python3 - "$upload_file" "$analysis_file" "$context_file" "$report_file" "$fixture_sha256" <<'PY'
import json
import sys
from pathlib import Path

upload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
analysis = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
context = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))
report = Path(sys.argv[4]).read_text(encoding="utf-8")
expected_hash = sys.argv[5]

assert upload["sha256"] == expected_hash
assert upload["record_count"] == 1
assert analysis["latest_analysis"]["summary"]["observation_count"] == 1
assert len(analysis["latest_analysis"]["output_sha256"]) == 64
assert context["context_contract"] == "nettap-evidence-context/v1"
assert context["data_state"] == "uploaded"
assert context["live_telemetry_connected"] is False
assert context["raw_evidence_included"] is False
assert context["analysis_artifact"]["output_sha256"] == analysis["latest_analysis"]["output_sha256"]
assert len(context["sources"]) == 1
assert context["sources"][0]["sha256"] == expected_hash
assert "record" not in context
assert "normalized observations" not in json.dumps(context).lower()
assert "live telemetry is not connected" in report.lower()
assert "raw evidence is retained locally" in report.lower()
assert "analysis artifact sha-256" in report.lower()
PY

echo "PASS: authenticated chat evidence-ingestion runtime workflow (${mode})"
echo "Case ID: $case_id"
echo "Source SHA-256: $fixture_sha256"
