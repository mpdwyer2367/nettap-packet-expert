#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"
require_runtime
[[ -f "$env_file" ]] || { echo "NetTAP AI Suite has not been initialized."; exit 1; }
mode="$(load_env_value DEPLOYMENT_MODE)"
if [[ "$mode" == "production" ]]; then
  "${compose_production[@]}" ps
  "${compose_production[@]}" exec -T ollama ollama list
else
  "${compose_local[@]}" ps
  "${compose_local[@]}" exec -T ollama ollama list
fi
echo "Network & Visibility: http://127.0.0.1:$(load_env_value VISIBILITY_LAUNCHER_PORT)"
echo "Packet Expert: http://127.0.0.1:$(load_env_value PACKET_EXPERT_LAUNCHER_PORT)"
echo "Shared Open WebUI: http://127.0.0.1:$(load_env_value WEB_PORT)"
