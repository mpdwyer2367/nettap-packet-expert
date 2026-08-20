#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

if [[ "$(uname -s)" != Linux ]] || grep -Eiq 'microsoft|wsl' /proc/version 2>/dev/null; then
  echo "ERROR: This entry point requires native Linux. Use start-wsl2.sh inside WSL2." >&2
  exit 2
fi

require_runtime
initialize_env
docker info >/dev/null 2>&1 || {
  echo "ERROR: Docker Engine is installed but its daemon is not running or the current user cannot access it." >&2
  exit 3
}

architecture="$(uname -m)"
case "$architecture" in
  x86_64|aarch64|arm64) ;;
  *) echo "ERROR: Unsupported Linux architecture: $architecture" >&2; exit 2 ;;
esac

available_kib="$(df -Pk "$project_dir" | awk 'NR==2 {print $4}')"
if [[ -n "$available_kib" && "$available_kib" -lt 20971520 ]]; then
  echo "ERROR: At least 20 GiB of free disk is required for images, model, and data." >&2
  exit 4
fi

set_env_value DEPLOYMENT_MODE local
initialize_model_with_temporary_egress local
"${compose_local[@]}" ps

echo "NetTAP Network Intelligence: http://127.0.0.1:$(load_env_value WEB_PORT)"
echo "Network & Visibility: http://127.0.0.1:$(load_env_value VISIBILITY_LAUNCHER_PORT)"
echo "Packet Expert: http://127.0.0.1:$(load_env_value PACKET_EXPERT_LAUNCHER_PORT)"
echo "Evidence Workspace: http://127.0.0.1:$(load_env_value EVIDENCE_PORT)"
echo "Evidence API token file: $evidence_token_file"
echo "Bootstrap credential file: $bootstrap_password_file"
echo "Immediately change the generated password in Settings > Account."
echo "Then run ./scripts/finalize-admin.sh --confirm after verifying the old password fails."
echo "Both experiences use one shared NetTAP Network Intelligence Model and one verified Qwen3.5 9B Q4_K_M base in the shared Ollama volume."
