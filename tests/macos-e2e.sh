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
nettap_model="$(load_env_value NETTAP_AI_MODEL)"
web_port="$(load_env_value WEB_PORT)"
visibility_port="$(load_env_value VISIBILITY_LAUNCHER_PORT)"
packet_port="$(load_env_value PACKET_EXPERT_LAUNCHER_PORT)"
visibility_profile="$(load_env_value NETTAP_VISIBILITY_PROFILE)"
packet_profile="$(load_env_value NETTAP_PACKET_EXPERT_PROFILE)"

"${compose[@]}" exec -T ollama ollama show "$nettap_model" | grep -q 'You are NetTAP AI'

admin_count="$("${compose[@]}" exec -T open-webui python - <<'PY'
import sqlite3

db = sqlite3.connect('/app/backend/data/webui.db')
print(db.execute("SELECT COUNT(*) FROM user WHERE role = 'admin'").fetchone()[0])
PY
)"
[[ "$admin_count" -ge 1 ]] || { echo "FAIL: Open WebUI has no administrator account."; exit 6; }

response="$("${compose[@]}" exec -T ollama ollama run "$nettap_model" \
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
  --write-out '%{redirect_url}' "http://127.0.0.1:${visibility_port}/open" | grep -Fq "model=${visibility_profile}"
curl --fail --silent --show-error --output /dev/null \
  --write-out '%{redirect_url}' "http://127.0.0.1:${packet_port}/open" | grep -Fq "model=${packet_profile}"

"${compose[@]}" restart ollama open-webui assistant-launcher
"${compose[@]}" exec -T ollama ollama show "$nettap_model" >/dev/null
ui_ready=false
for _ in $(seq 1 60); do
  if curl --fail --silent --show-error "http://127.0.0.1:${web_port}/health" >/dev/null; then
    ui_ready=true
    break
  fi
  sleep 2
done
[[ "$ui_ready" == true ]] || { echo "FAIL: Open WebUI did not recover after restart."; exit 8; }

echo "PASS: administrator presence, one combined model identity, automatic profile/RAG provisioning, inference, both launchers, UI health, and restart persistence checks completed."
echo "Manual acceptance is still required on a fresh data volume: use the generated credential, change it, confirm it fails, finalize activation, confirm the new password survives restart, and validate representative browser chats in both managed profiles."
echo "Report: $report_file"
