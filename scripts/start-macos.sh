#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

[[ "$(uname -s)" == "Darwin" ]] || {
  echo "ERROR: This entry point is for macOS. Use Docker Compose directly on other hosts." >&2
  exit 2
}

require_runtime
initialize_env

architecture="$(uname -m)"
case "$architecture" in
  arm64|x86_64) ;;
  *) echo "ERROR: Unsupported macOS architecture: $architecture" >&2; exit 2 ;;
esac

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker Desktop is installed but its engine is not running." >&2
  exit 3
fi
stop_legacy_runtime_preserving_data
prepare_canonical_admin_bootstrap

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
evidence_port="$(load_env_value EVIDENCE_PORT)"
echo "NetTAP Network Intelligence: http://127.0.0.1:${web_port}"
echo "Network & Visibility: http://127.0.0.1:${visibility_port}"
echo "Packet Expert: http://127.0.0.1:${packet_port}"
echo "Evidence Workspace: http://127.0.0.1:${evidence_port}"
echo "Evidence API token file: $evidence_token_file"
echo "Bootstrap credential file: $bootstrap_password_file"
echo "Immediately change the generated password in Settings > Account."
echo "Then run ./scripts/finalize-admin.sh --confirm after verifying the old password fails."
echo "Existing Open WebUI volumes keep their existing accounts and passwords."
echo "Keep loopback binding until TLS and access controls are configured."
echo "Both experiences use one shared NetTAP Network Intelligence Model and one Qwen2.5 7B base in the shared Ollama volume."
echo "Apple Silicon note: Dockerized Ollama is CPU-compatible; Docker Desktop does not expose Metal acceleration to this Linux container."
