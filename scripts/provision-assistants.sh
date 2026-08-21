#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

[[ "${1:-}" == "--confirm" && $# -eq 1 ]] || {
  echo "Usage: ./scripts/provision-assistants.sh --confirm" >&2
  exit 2
}
require_runtime
[[ -f "$env_file" ]] || { echo "ERROR: Deployment is not initialized." >&2; exit 3; }
mode="$(load_env_value DEPLOYMENT_MODE)"
if [[ "$mode" == production ]]; then
  provision_assistants production
else
  provision_assistants local
fi
