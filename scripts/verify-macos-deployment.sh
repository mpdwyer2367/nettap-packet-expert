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

fail() {
  echo "FAIL: $1" >&2
  echo "Report: $report_file" >&2
  exit 1
}

echo "NetTAP Network Intelligence canonical ${platform} runtime verification"
echo "UTC: $(date -u +%FT%TZ)"
echo "Host: $(uname -a)"
echo "Project directory: $project_dir"

if [[ "$platform" == macos ]]; then
  [[ "$(uname -s)" == Darwin ]] || fail "macOS host required."
else
  if [[ "$(uname -s)" != Linux ]] || ! grep -Eiq 'microsoft|wsl' /proc/version; then
    fail "Windows/WSL2 host required."
  fi
fi
require_runtime
[[ -f "$env_file" ]] || fail "Missing .env. Run ./scripts/start-macos.sh first."
docker info >/dev/null 2>&1 || fail "Docker Desktop engine is not running."

nettap_model="$(load_env_value NETTAP_AI_MODEL)"
web_port="$(load_env_value WEB_PORT)"
visibility_port="$(load_env_value VISIBILITY_LAUNCHER_PORT)"
packet_port="$(load_env_value PACKET_EXPERT_LAUNCHER_PORT)"
evidence_port="$(load_env_value EVIDENCE_PORT)"
bind_address="$(load_env_value BIND_ADDRESS)"
ollama_image="$(load_env_value OLLAMA_IMAGE)"
webui_image="$(load_env_value OPEN_WEBUI_IMAGE)"

[[ "$nettap_model" == "nettap-ai:0.3.0-rc.3" ]] || fail "Unexpected Network Intelligence model identity: $nettap_model"
[[ "$bind_address" == "127.0.0.1" ]] || fail "BIND_ADDRESS must remain 127.0.0.1 for the local profile."
"${compose[@]}" config >/dev/null || fail "Compose configuration is invalid."

ollama_id="$("${compose[@]}" ps -q ollama)"
webui_id="$("${compose[@]}" ps -q open-webui)"
launcher_id="$("${compose[@]}" ps -q assistant-launcher)"
evidence_id="$("${compose[@]}" ps -q evidence-service)"
[[ -n "$ollama_id" ]] || fail "Ollama service container is not running."
[[ -n "$webui_id" ]] || fail "Open WebUI service container is not running."
[[ -n "$launcher_id" ]] || fail "Assistant launcher service container is not running."
[[ -n "$evidence_id" ]] || fail "Evidence Workspace service container is not running."

verify_provenance() {
  local container_id="$1" service="$2" expected_image="$3"
  local working_dir config_files actual_image state
  working_dir="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$container_id")"
  config_files="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$container_id")"
  actual_image="$(docker inspect --format '{{.Config.Image}}' "$container_id")"
  state="$(docker inspect --format '{{.State.Status}}' "$container_id")"
  [[ "$working_dir" == "$project_dir" ]] || fail "$service was created from $working_dir, not $project_dir. Recreate the project from the canonical directory."
  [[ "$config_files" == *"${project_dir}/compose.yaml"* && "$config_files" == *"${project_dir}/compose.local.yaml"* ]] || fail "$service uses unexpected Compose files: $config_files"
  [[ "$actual_image" == "$expected_image" ]] || fail "$service image is $actual_image; expected $expected_image."
  [[ "$state" == "running" ]] || fail "$service state is $state, not running."
  echo "PASS: $service provenance, image, and running state"
}

verify_provenance "$ollama_id" ollama "$ollama_image"
verify_provenance "$webui_id" open-webui "$webui_image"
verify_provenance "$launcher_id" assistant-launcher "$(load_env_value CADDY_IMAGE)"
verify_provenance "$evidence_id" evidence-service "$webui_image"

ollama_ports="$(docker inspect --format '{{json .NetworkSettings.Ports}}' "$ollama_id")"
[[ "$ollama_ports" == *'11434/tcp":null'* ]] || fail "Containerized Ollama unexpectedly publishes a host port: $ollama_ports"
echo "PASS: containerized Ollama has no published host port"
if docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$ollama_id" | grep -q 'model-egress'; then
  fail "Temporary model-registry egress remains attached."
fi
echo "PASS: temporary model-registry egress is absent"

webui_binding="$(docker port "$webui_id" 8080/tcp 2>/dev/null || true)"
[[ "$webui_binding" == "${bind_address}:${web_port}" ]] || fail "Open WebUI binding is $webui_binding; expected ${bind_address}:${web_port}."
echo "PASS: Open WebUI is bound to ${bind_address}:${web_port}"
evidence_binding="$(docker port "$evidence_id" 8081/tcp 2>/dev/null || true)"
[[ "$evidence_binding" == "${bind_address}:${evidence_port}" ]] || fail "Evidence Workspace binding is $evidence_binding; expected ${bind_address}:${evidence_port}."
echo "PASS: Evidence Workspace is bound to ${bind_address}:${evidence_port}"

"${compose[@]}" exec -T ollama ollama show "$nettap_model" | grep -q 'You are NetTAP AI' || fail "Network Intelligence model identity check failed."
echo "PASS: NetTAP Network Intelligence Model is installed"

"${compose[@]}" exec -T open-webui python - <<'PY' || fail "Provisioned assistants or offline RAG state is invalid."
import json
import hashlib
from pathlib import Path
embedding = json.loads(Path('/app/backend/data/nettap-embedding-model.json').read_text(encoding='utf-8'))
provisioning = json.loads(Path('/app/backend/data/nettap-provisioning-state.json').read_text(encoding='utf-8'))
assert embedding['revision'] == '1110a243fdf4706b3f48f1d95db1a4f5529b4d41'
assert embedding['model_path'] == '/app/backend/data/nettap-models/all-MiniLM-L6-v2/1110a243fdf4706b3f48f1d95db1a4f5529b4d41'
assert embedding['embedding_dimension'] > 0
aggregate = hashlib.sha256()
expected_files = set()
for item in embedding['files']:
    expected_files.add(item['path'])
    path = Path(embedding['model_path']) / item['path']
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    assert digest == item['sha256']
    aggregate.update(item['path'].encode('utf-8'))
    aggregate.update(b'\0')
    aggregate.update(digest.encode('ascii'))
    aggregate.update(b'\n')
actual_files = {
    path.relative_to(embedding['model_path']).as_posix()
    for path in Path(embedding['model_path']).rglob('*')
    if path.is_file() and '.cache' not in path.parts
}
assert actual_files == expected_files
assert aggregate.hexdigest() == embedding['aggregate_sha256']
assert provisioning['release_version'] == '0.3.0-rc.3'
assert provisioning['offline_rag']['result'] == 'PASS'
assert {item['id'] for item in provisioning['assistants']} == {
    'nettap-network-visibility', 'nettap-packet-expert'
}
assert set(provisioning['knowledge']) == {'shared', 'network_visibility', 'packet_expert'}
assert set(provisioning['skills']) == {'network_visibility', 'packet_expert'}
assistant_skills = {item['id']: item['skill_ids'] for item in provisioning['assistants']}
assert assistant_skills == {
    'nettap-network-visibility': ['nettap-network-visibility'],
    'nettap-packet-expert': ['nettap-packet-expert'],
}
PY
[[ "$(installed_provisioning_fingerprint local)" == "$(provisioning_fingerprint local)" ]] || \
  fail "Installed provisioning fingerprint differs from the RC3 source."
echo "PASS: pinned embedding cache, managed skills, managed assistants, and offline RAG proof"

admin_count="$("${compose[@]}" exec -T open-webui python - <<'PY'
import sqlite3
db = sqlite3.connect('/app/backend/data/webui.db')
print(db.execute("SELECT COUNT(*) FROM user WHERE role = 'admin'").fetchone()[0])
PY
)"
[[ "$admin_count" -ge 1 ]] || fail "Open WebUI has no administrator account."
echo "PASS: Open WebUI administrator exists"

curl --fail --silent --show-error "http://${bind_address}:${web_port}/health" >/dev/null || fail "Open WebUI health endpoint failed."
echo "PASS: Open WebUI health endpoint"
curl --fail --silent --show-error "http://${bind_address}:${visibility_port}/" | grep -q 'Network &amp; Visibility' || fail "Network & Visibility launcher failed."
curl --fail --silent --show-error "http://${bind_address}:${packet_port}/" | grep -q 'Packet Expert' || fail "Packet Expert launcher failed."
echo "PASS: both assistant launchers"
curl --fail --silent --show-error --output /dev/null --write-out '%{redirect_url}' \
  "http://${bind_address}:${visibility_port}/open" | grep -Fq 'model=nettap-network-visibility' || fail "Network launcher did not select its managed profile."
curl --fail --silent --show-error --output /dev/null --write-out '%{redirect_url}' \
  "http://${bind_address}:${packet_port}/open" | grep -Fq 'model=nettap-packet-expert' || fail "Packet launcher did not select its managed profile."
echo "PASS: launchers select the correct managed Workspace Models"

"${project_dir}/tests/evidence-runtime-e2e.sh" || fail "Evidence Workspace runtime workflow failed."

response="$("${compose[@]}" exec -T ollama ollama run "$nettap_model" \
  'No capture or telemetry is connected. State whether live network evidence is available, then ask one important question.')"
[[ -n "$response" ]] || fail "Controlled inference returned no output."
printf '%s\n' "$response" | grep -Eiq \
  "no live|not connected|cannot (see|access|observe)|do not have access|don't have access|unavailable" || \
  fail "Controlled inference did not clearly state the live-evidence boundary."
echo "PASS: controlled model inference returned output"

echo "PASS: automated canonical runtime checks, including local evidence ingestion and analysis, completed."
echo "Manual acceptance remains required: generated-password replacement and rejection, finalization, new-password persistence, browser rendering, and representative chat behavior."
echo "Report: $report_file"
