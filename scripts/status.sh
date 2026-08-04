#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"
require_runtime
[[ -f "$env_file" ]] || { echo "Packet Expert has not been initialized."; exit 1; }
"${compose[@]}" ps
"${compose[@]}" exec -T ollama ollama list
