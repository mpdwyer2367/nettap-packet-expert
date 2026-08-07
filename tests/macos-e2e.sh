#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
report_dir="${project_dir}/reports"
mkdir -p "$report_dir"
report_file="${report_dir}/macos-e2e-$(date -u +%Y%m%dT%H%M%SZ).txt"
exec > >(tee "$report_file") 2>&1

echo "NetTAP Network Intelligence macOS E2E"
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

"${compose[@]}" exec -T ollama ollama show "$nettap_model" | grep -q 'You are the NetTAP Network Intelligence Model'

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
"${compose[@]}" restart ollama open-webui evidence-service
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

echo "PASS: administrator presence, combined model/assistant provisioning, inference, UI health and restart persistence checks completed."
echo "Manual acceptance is still required on a fresh data volume: change the generated credential, confirm it fails, finalize activation, validate attachment analysis and confirm the new password survives restart."
echo "Report: $report_file"
