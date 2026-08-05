#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"
require_runtime
[[ -f "$env_file" ]] || { echo "NetTAP AI Suite has not been initialized."; exit 0; }
mode="$(load_env_value DEPLOYMENT_MODE)"
if [[ "$mode" == "production" ]]; then
  "${compose_production[@]}" down
else
  "${compose_local[@]}" down
fi
echo "NetTAP AI Suite stopped. Shared persistent volumes were preserved."
