#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

if [[ "$(uname -s)" != Linux ]] || ! grep -Eiq 'microsoft|wsl' /proc/version; then
  echo "ERROR: This entry point requires Windows Subsystem for Linux 2." >&2
  exit 2
fi

require_runtime
initialize_env
docker info >/dev/null 2>&1 || {
  echo "ERROR: Docker Desktop integration is installed but its engine is not running." >&2
  exit 3
}

architecture="$(uname -m)"
case "$architecture" in
  x86_64|aarch64|arm64) ;;
  *) echo "ERROR: Unsupported WSL2 architecture: $architecture" >&2; exit 2 ;;
esac

available_kib="$(df -Pk "$project_dir" | awk 'NR==2 {print $4}')"
if [[ -n "$available_kib" && "$available_kib" -lt 15728640 ]]; then
  echo "ERROR: At least 15 GiB of free disk is required for images, model, and data." >&2
  exit 4
fi

set_env_value DEPLOYMENT_MODE local
initialize_model_with_temporary_egress local
"${compose_local[@]}" ps

web_port="$(load_env_value WEB_PORT)"
visibility_port="$(load_env_value VISIBILITY_LAUNCHER_PORT)"
packet_port="$(load_env_value PACKET_EXPERT_LAUNCHER_PORT)"
echo "NetTAP AI Suite: http://127.0.0.1:${web_port}"
echo "Network & Visibility: http://127.0.0.1:${visibility_port}"
echo "Packet Expert: http://127.0.0.1:${packet_port}"
echo "Bootstrap credential file: $bootstrap_password_file"
echo "Immediately change the generated password in Settings > Account."
echo "Then run ./scripts/finalize-admin.sh --confirm after verifying the old password fails."
echo "Existing Open WebUI volumes keep their existing accounts and passwords."
echo "Keep loopback binding until TLS and access controls are configured."
echo "Both assistant experiences use one combined NetTAP AI model and one Qwen2.5 7B base in the shared Ollama volume."
