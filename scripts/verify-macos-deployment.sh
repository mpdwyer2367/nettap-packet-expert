#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

report_dir="${project_dir}/reports"
mkdir -p "$report_dir"
report_file="${report_dir}/macos-runtime-verification-$(date -u +%Y%m%dT%H%M%SZ).txt"
exec > >(tee "$report_file") 2>&1

fail() {
  echo "FAIL: $1" >&2
  echo "Report: $report_file" >&2
  exit 1
}

echo "NetTAP Packet Expert canonical macOS runtime verification"
echo "UTC: $(date -u +%FT%TZ)"
echo "Host: $(uname -a)"
echo "Project directory: $project_dir"

[[ "$(uname -s)" == "Darwin" ]] || fail "macOS host required."
require_runtime
[[ -f "$env_file" ]] || fail "Missing .env. Run ./scripts/start-macos.sh first."
docker info >/dev/null 2>&1 || fail "Docker Desktop engine is not running."

model_name="$(load_env_value MODEL_NAME)"
web_port="$(load_env_value WEB_PORT)"
bind_address="$(load_env_value BIND_ADDRESS)"
ollama_image="$(load_env_value OLLAMA_IMAGE)"
webui_image="$(load_env_value OPEN_WEBUI_IMAGE)"

[[ "$model_name" == "nettap-packet-expert:0.1.0-rc.8" ]] || fail "Unexpected model identity: $model_name"
[[ "$bind_address" == "127.0.0.1" ]] || fail "BIND_ADDRESS must remain 127.0.0.1 for the local RC8 profile."
"${compose[@]}" config >/dev/null || fail "Compose configuration is invalid."

ollama_id="$("${compose[@]}" ps -q ollama)"
webui_id="$("${compose[@]}" ps -q open-webui)"
[[ -n "$ollama_id" ]] || fail "Ollama service container is not running."
[[ -n "$webui_id" ]] || fail "Open WebUI service container is not running."

verify_provenance() {
  local container_id="$1" service="$2" expected_image="$3"
  local working_dir config_files actual_image state
  working_dir="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$container_id")"
  config_files="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$container_id")"
  actual_image="$(docker inspect --format '{{.Config.Image}}' "$container_id")"
  state="$(docker inspect --format '{{.State.Status}}' "$container_id")"
  [[ "$working_dir" == "$project_dir" ]] || fail "$service was created from $working_dir, not $project_dir. Recreate the project from the canonical directory."
  [[ "$config_files" == "${project_dir}/compose.yaml" ]] || fail "$service uses unexpected Compose files: $config_files"
  [[ "$actual_image" == "$expected_image" ]] || fail "$service image is $actual_image; expected $expected_image."
  [[ "$state" == "running" ]] || fail "$service state is $state, not running."
  echo "PASS: $service provenance, image, and running state"
}

verify_provenance "$ollama_id" ollama "$ollama_image"
verify_provenance "$webui_id" open-webui "$webui_image"

ollama_ports="$(docker inspect --format '{{json .NetworkSettings.Ports}}' "$ollama_id")"
[[ "$ollama_ports" == *'11434/tcp":null'* ]] || fail "Containerized Ollama unexpectedly publishes a host port: $ollama_ports"
echo "PASS: containerized Ollama has no published host port"

webui_binding="$(docker port "$webui_id" 8080/tcp 2>/dev/null || true)"
[[ "$webui_binding" == "${bind_address}:${web_port}" ]] || fail "Open WebUI binding is $webui_binding; expected ${bind_address}:${web_port}."
echo "PASS: Open WebUI is bound to ${bind_address}:${web_port}"

"${compose[@]}" exec -T ollama ollama show "$model_name" | grep -q 'NetTAP Packet Expert' || fail "Custom model identity check failed."
echo "PASS: custom model $model_name is installed"

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

response="$("${compose[@]}" exec -T ollama ollama run "$model_name" \
  'No capture or telemetry is connected. State whether live network evidence is available, then ask one important question.')"
[[ -n "$response" ]] || fail "Controlled inference returned no output."
printf '%s\n' "$response" | grep -Eiq \
  "no live|not connected|cannot (see|access|observe)|do not have access|don't have access|unavailable" || \
  fail "Controlled inference did not clearly state the live-evidence boundary."
echo "PASS: controlled model inference returned output"

echo "PASS: automated canonical runtime checks completed."
echo "Manual acceptance remains required: password replacement on a fresh volume, old-password rejection, new-password persistence, model selection, four starter prompts, knowledge attachment, and browser chat behavior."
echo "Report: $report_file"
