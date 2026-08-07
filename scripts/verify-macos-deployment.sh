#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

platform="macos"
if [[ "${1:-}" == "--windows-wsl2" && $# -eq 1 ]]; then
  platform="windows-wsl2"
elif [[ $# -ne 0 ]]; then
  echo "Usage: ./scripts/verify-macos-deployment.sh [--windows-wsl2]" >&2
  exit 2
fi

report_dir="${project_dir}/reports"
mkdir -p "$report_dir"
report_file="${report_dir}/${platform}-runtime-verification-$(date -u +%Y%m%dT%H%M%SZ).txt"
exec > >(tee "$report_file") 2>&1
fail() { echo "FAIL: $1" >&2; echo "Report: $report_file" >&2; exit 1; }

echo "NetTAP Network Observability & Packet Analysis ${platform} runtime verification"
echo "UTC: $(date -u +%FT%TZ)"
echo "Host: $(uname -a)"
echo "Project directory: $project_dir"

if [[ "$platform" == macos ]]; then
  [[ "$(uname -s)" == Darwin ]] || fail "macOS host required."
else
  [[ "$(uname -s)" == Linux ]] && grep -Eiq 'microsoft|wsl' /proc/version || fail "Windows/WSL2 host required."
fi

require_runtime
[[ -f "$env_file" ]] || fail "Missing .env. Run the platform start command first."
docker info >/dev/null 2>&1 || fail "Docker Desktop engine is not running."
"${compose_local[@]}" config >/dev/null || fail "Compose configuration is invalid."

nettap_model="$(load_env_value NETTAP_AI_MODEL)"
[[ "$nettap_model" == "nettap-ai:0.3.0-rc.7" ]] || fail "Unexpected model identity: $nettap_model"
model_rows="$("${compose_local[@]}" exec -T ollama ollama list)"
legacy_models="$(printf '%s\n' "$model_rows" | awk -v current="$nettap_model" 'NR > 1 && $1 != current && ($1 ~ /^nettap-ai:/ || $1 ~ /^nettap-ai-backup-/ || $1 ~ /^nettap-packet-expert:/ || $1 ~ /^nettap-network-visibility:/) {print $1}')"
[[ -z "$legacy_models" ]] || fail "Superseded NetTAP model tags remain: $legacy_models"
echo "PASS: one current NetTAP model tag"

effective_project="$(deployment_project_name)"
verify_service() {
  local service="$1" expected_image="$2" id state image project
  id="$("${compose_local[@]}" ps -q "$service")"
  [[ -n "$id" ]] || fail "$service is not running."
  state="$(docker inspect --format '{{.State.Status}}' "$id")"
  image="$(docker inspect --format '{{.Config.Image}}' "$id")"
  project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$id")"
  [[ "$state" == running ]] || fail "$service state is $state."
  [[ "$image" == "$expected_image" ]] || fail "$service image is $image; expected $expected_image."
  [[ "$project" == "$effective_project" ]] || fail "$service belongs to $project; expected $effective_project."
  echo "PASS: $service provenance, image and running state"
}

verify_service ollama "$(load_env_value OLLAMA_IMAGE)"
verify_service open-webui "$(load_env_value OPEN_WEBUI_IMAGE)"
verify_service evidence-service "$(load_env_value OPEN_WEBUI_IMAGE)"

ollama_id="$("${compose_local[@]}" ps -q ollama)"
evidence_id="$("${compose_local[@]}" ps -q evidence-service)"
[[ -z "$(docker port "$ollama_id" 2>/dev/null || true)" ]] || fail "Ollama must not publish a host port."
[[ -z "$(docker port "$evidence_id" 2>/dev/null || true)" ]] || fail "The internal evidence service must not publish a host port."
echo "PASS: model and evidence services are internal only"

bind_address="$(load_env_value BIND_ADDRESS)"
web_port="$(load_env_value WEB_PORT)"
[[ "$bind_address" == 127.0.0.1 ]] || fail "Local BIND_ADDRESS must be 127.0.0.1."
webui_id="$("${compose_local[@]}" ps -q open-webui)"
[[ "$(docker port "$webui_id" 8080/tcp 2>/dev/null || true)" == "${bind_address}:${web_port}" ]] || fail "Open WebUI is not bound to ${bind_address}:${web_port}."
curl --fail --silent --show-error "http://${bind_address}:${web_port}/health" >/dev/null || fail "Open WebUI health endpoint failed."
echo "PASS: one authenticated UI is reachable at http://${bind_address}:${web_port}"

"${compose_local[@]}" exec -T open-webui python - <<'PY' || fail "Managed assistant or offline RAG state is invalid."
import json
from pathlib import Path
p = json.loads(Path('/app/backend/data/nettap-provisioning-state.json').read_text(encoding='utf-8'))
e = json.loads(Path('/app/backend/data/nettap-embedding-model.json').read_text(encoding='utf-8'))
assert p['release_version'] == '0.3.0-rc.7'
assert p['offline_rag']['result'] == 'PASS'
assert {a['id'] for a in p['assistants']} == {'nettap-network-operations'}
assert set(p['knowledge']) == {'shared', 'network_visibility', 'packet_expert'}
assert set(p['skills']) == {'network_operations'}
assert set(p['functions']) == {'evidence_ingestion'}
assert e['revision'] == '1110a243fdf4706b3f48f1d95db1a4f5529b4d41'
PY
[[ "$(installed_provisioning_fingerprint local)" == "$(provisioning_fingerprint local)" ]] || fail "Installed provisioning fingerprint differs from RC7 source."
echo "PASS: combined assistant, managed ingestion filter and offline RAG"

response="$("${compose_local[@]}" exec -T ollama ollama run "$nettap_model" 'No evidence is connected. State the evidence boundary and ask one important question.')"
[[ -n "$response" ]] || fail "Controlled inference returned no output."
printf '%s\n' "$response" | grep -Eiq 'no live|not connected|cannot (see|access|observe)|do not have access|unavailable' || fail "Model did not state the evidence boundary."
echo "PASS: controlled inference"

echo "PASS: automated runtime checks completed."
echo "Manual acceptance remains required for first-login password change, attachment analysis, browser rendering, backup/restore and rollback."
echo "Report: $report_file"
