#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"
require_runtime
[[ -f "$env_file" ]] || { echo "Packet Expert has not been initialized."; exit 0; }
"${compose[@]}" down
echo "Packet Expert stopped. Persistent volumes were preserved."
