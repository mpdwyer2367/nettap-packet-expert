#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"
require_runtime
[[ -f "$env_file" ]] || { echo "NetTAP Network Intelligence has not been initialized."; exit 1; }
mode="$(load_env_value DEPLOYMENT_MODE)"
if [[ "$mode" == "production" ]]; then
  "${compose_production[@]}" ps
  "${compose_production[@]}" exec -T ollama ollama list
  hostname="$(load_env_value APPLIANCE_HOSTNAME)"
  https_port="$(load_env_value HTTPS_PORT)"
  echo "NetTAP Network Observability & Packet Analysis: https://${hostname}:${https_port}/"
else
  "${compose_local[@]}" ps
  "${compose_local[@]}" exec -T ollama ollama list
  echo "NetTAP Network Observability & Packet Analysis: http://127.0.0.1:$(load_env_value WEB_PORT)"
fi
