#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"
require_runtime
[[ -f "$env_file" ]] || { echo "Packet Expert has not been initialized."; exit 1; }
mode="$(load_env_value DEPLOYMENT_MODE)"
if [[ "$mode" == "production" ]]; then
  "${compose_production[@]}" ps
  "${compose_production[@]}" exec -T ollama ollama list
else
  "${compose_local[@]}" ps
  "${compose_local[@]}" exec -T ollama ollama list
fi
