#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

[[ "$(uname -s)" == "Darwin" ]] || {
  echo "ERROR: This repair entry point is for macOS." >&2
  exit 2
}

require_runtime
require_command curl
[[ -f "$env_file" ]] || {
  echo "ERROR: NetTAP Network Intelligence is not initialized. Run ./scripts/start-macos.sh." >&2
  exit 3
}
docker info >/dev/null 2>&1 || {
  echo "ERROR: Docker Desktop is installed but its engine is not running." >&2
  exit 3
}

echo "Recreating only the NetTAP browser interface services; persistent volumes are preserved."
recreate_local_interfaces
echo "Running canonical macOS verification."
exec "${script_dir}/verify-macos-deployment.sh"
