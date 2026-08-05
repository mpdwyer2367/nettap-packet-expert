#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"
[[ "${1:-}" == "--confirm" && $# -eq 1 ]] || {
  echo "Usage: ./scripts/update-model.sh --confirm" >&2
  exit 2
}
require_runtime
[[ -f "$env_file" ]] || { echo "ERROR: Run start-macos.sh first." >&2; exit 3; }
initialize_env
mode="$(load_env_value DEPLOYMENT_MODE)"
if [[ "$mode" == "production" ]]; then
  initialize_model_with_temporary_egress production
else
  initialize_model_with_temporary_egress local
fi
echo "The combined NetTAP AI model was rebuilt from the shared base. Run ./tests/macos-e2e.sh before publishing a release."
