#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${project_dir}/scripts/common.sh"
require_runtime
[[ -f "$env_file" ]] || { echo "ERROR: Deploy and create the first administrator first." >&2; exit 3; }
"${compose[@]}" run --rm workspace-init --validate-only --wait-timeout 30
