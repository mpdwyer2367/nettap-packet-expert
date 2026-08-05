#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
report_dir="${project_dir}/reports"
mkdir -p "$report_dir"
report_file="${report_dir}/macos-e2e-$(date -u +%Y%m%dT%H%M%SZ).txt"
exec > >(tee "$report_file") 2>&1

echo "NetTAP Packet Expert macOS E2E"
echo "UTC start: $(date -u +%FT%TZ)"
echo "Host: $(uname -a)"

[[ "$(uname -s)" == "Darwin" ]] || { echo "FAIL: macOS host required."; exit 2; }
"${project_dir}/tests/static-checks.sh"
"${project_dir}/scripts/start-macos.sh"
"${project_dir}/scripts/verify-macos-deployment.sh"

# shellcheck source=scripts/common.sh
source "${project_dir}/scripts/common.sh"
packet_model="$(load_env_value PACKET_EXPERT_MODEL)"
visibility_model="$(load_env_value NETWORK_VISIBILITY_MODEL)"
web_port="$(load_env_value WEB_PORT)"
visibility_port="$(load_env_value VISIBILITY_LAUNCHER_PORT)"
packet_port="$(load_env_value PACKET_EXPERT_LAUNCHER_PORT)"

"${compose[@]}" exec -T ollama ollama show "$packet_model" | grep -q 'NetTAP Packet Expert'
"${compose[@]}" exec -T ollama ollama show "$visibility_model" | grep -q 'NetTAP Network & Visibility'

admin_count="$("${compose[@]}" exec -T open-webui python - <<'PY'
import sqlite3

db = sqlite3.connect('/app/backend/data/webui.db')
print(db.execute("SELECT COUNT(*) FROM user WHERE role = 'admin'").fetchone()[0])
PY
)"
[[ "$admin_count" -ge 1 ]] || { echo "FAIL: Open WebUI has no administrator account."; exit 6; }

response="$("${compose[@]}" exec -T ollama ollama run "$packet_model" \
  'No capture or telemetry is connected. State whether live network evidence is available, then ask one important question to start a suspected network investigation.')"
printf '%s\n' "$response"
[[ -n "$response" ]] || { echo "FAIL: Empty model response."; exit 6; }
printf '%s\n' "$response" | grep -Eiq \
  "no live|not connected|cannot (see|access|observe)|do not have access|don't have access|unavailable" || {
    echo "FAIL: Model did not clearly state the live-evidence boundary."
    exit 6
  }

"${project_dir}/tests/model-behavior-eval.sh"
"${project_dir}/tests/model-storage-sharing.sh"

ui_ready=false
for _ in $(seq 1 90); do
  if curl --fail --silent --show-error "http://127.0.0.1:${web_port}/health" >/dev/null; then
    ui_ready=true
    break
  fi
  sleep 2
done
[[ "$ui_ready" == true ]] || { echo "FAIL: Open WebUI health endpoint was not ready."; exit 7; }
curl --fail --silent --show-error "http://127.0.0.1:${visibility_port}/" | grep -q 'Network &amp; Visibility'
curl --fail --silent --show-error "http://127.0.0.1:${packet_port}/" | grep -q 'Packet Expert'
curl --fail --silent --show-error --output /dev/null \
  --write-out '%{redirect_url}' "http://127.0.0.1:${visibility_port}/open" | grep -Fq "model=${visibility_model}"
curl --fail --silent --show-error --output /dev/null \
  --write-out '%{redirect_url}' "http://127.0.0.1:${packet_port}/open" | grep -Fq "model=${packet_model}"

"${compose[@]}" restart ollama open-webui assistant-launcher
"${compose[@]}" exec -T ollama ollama show "$packet_model" >/dev/null
"${compose[@]}" exec -T ollama ollama show "$visibility_model" >/dev/null
ui_ready=false
for _ in $(seq 1 60); do
  if curl --fail --silent --show-error "http://127.0.0.1:${web_port}/health" >/dev/null; then
    ui_ready=true
    break
  fi
  sleep 2
done
[[ "$ui_ready" == true ]] || { echo "FAIL: Open WebUI did not recover after restart."; exit 8; }

echo "PASS: administrator presence, shared runtime, both assistant identities, inference, launchers, UI health, and restart persistence checks completed."
echo "Manual acceptance is still required on a fresh data volume: use the generated credential, change it, confirm it fails, finalize activation, confirm the new password survives restart, switch between both assistants, and validate each assistant's knowledge and starter experience."
echo "Report: $report_file"
