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
model_name="$(load_env_value MODEL_NAME)"
web_port="$(load_env_value WEB_PORT)"

"${compose[@]}" exec -T ollama ollama show "$model_name" | grep -q 'NetTAP Packet Expert'

admin_count="$("${compose[@]}" exec -T open-webui python - <<'PY'
import sqlite3

db = sqlite3.connect('/app/backend/data/webui.db')
print(db.execute("SELECT COUNT(*) FROM user WHERE role = 'admin'").fetchone()[0])
PY
)"
[[ "$admin_count" -ge 1 ]] || { echo "FAIL: Open WebUI has no administrator account."; exit 6; }

response="$("${compose[@]}" exec -T ollama ollama run "$model_name" \
  'No capture or telemetry is connected. State whether live network evidence is available, then ask one important question to start a suspected network investigation.')"
printf '%s\n' "$response"
[[ -n "$response" ]] || { echo "FAIL: Empty model response."; exit 6; }
printf '%s\n' "$response" | grep -Eiq \
  "no live|not connected|cannot (see|access|observe)|do not have access|don't have access|unavailable" || {
    echo "FAIL: Model did not clearly state the live-evidence boundary."
    exit 6
  }

"${project_dir}/tests/model-behavior-eval.sh"

ui_ready=false
for _ in $(seq 1 90); do
  if curl --fail --silent --show-error "http://127.0.0.1:${web_port}/health" >/dev/null; then
    ui_ready=true
    break
  fi
  sleep 2
done
[[ "$ui_ready" == true ]] || { echo "FAIL: Open WebUI health endpoint was not ready."; exit 7; }

"${compose[@]}" restart ollama open-webui
"${compose[@]}" exec -T ollama ollama show "$model_name" >/dev/null
ui_ready=false
for _ in $(seq 1 60); do
  if curl --fail --silent --show-error "http://127.0.0.1:${web_port}/health" >/dev/null; then
    ui_ready=true
    break
  fi
  sleep 2
done
[[ "$ui_ready" == true ]] || { echo "FAIL: Open WebUI did not recover after restart."; exit 8; }

echo "PASS: administrator presence, model identity, inference, UI health, and restart persistence checks completed."
echo "Manual acceptance still required on a fresh data volume: use the locally generated credential, change it, confirm it fails, finalize activation, confirm the new password survives restart, select the model, submit a chat, and verify four starter prompts."
echo "Report: $report_file"
