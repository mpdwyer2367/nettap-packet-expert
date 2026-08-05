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
echo "This compatibility command now updates the complete release: Ollama, knowledge, Skills, and retrieval validation."
exec "${script_dir}/update-release.sh" --confirm
