#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/common.sh"
[[ "${1:-}" == "--confirm" && $# -eq 1 ]] || { echo "Usage: ./scripts/update-release.sh --confirm" >&2; exit 2; }
require_runtime
[[ -f "$env_file" ]] || { echo "ERROR: Deploy and create the first administrator first." >&2; exit 3; }
"${project_dir}/tests/static-checks.sh"
"${compose[@]}" --profile initialize run --rm model-init
"${compose[@]}" run --rm workspace-init --wait-timeout 30
"${project_dir}/tests/retrieval-e2e.sh"
echo "Release sources rebuilt and validated. Review git diff, commit, and push the source files."
