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
  hostname="$(load_env_value APPLIANCE_HOSTNAME)"
  https_port="$(load_env_value HTTPS_PORT)"
  echo "Network & Visibility: https://${hostname}:${https_port}/visibility"
  echo "Packet Expert: https://${hostname}:${https_port}/packet-expert"
  echo "Shared Open WebUI: https://${hostname}:${https_port}/"
  echo "Evidence Workspace: https://${hostname}:${https_port}/evidence/"
else
  "${compose_local[@]}" ps
  "${compose_local[@]}" exec -T ollama ollama list
  echo "Network & Visibility: http://127.0.0.1:$(load_env_value VISIBILITY_LAUNCHER_PORT)"
  echo "Packet Expert: http://127.0.0.1:$(load_env_value PACKET_EXPERT_LAUNCHER_PORT)"
  echo "Shared Open WebUI: http://127.0.0.1:$(load_env_value WEB_PORT)"
  echo "Evidence Workspace: http://127.0.0.1:$(load_env_value EVIDENCE_PORT)"
fi
