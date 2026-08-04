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

available_kib="$(df -Pk "$project_dir" | awk 'NR==2 {print $4}')"
if [[ -n "$available_kib" && "$available_kib" -lt 15728640 ]]; then
  echo "ERROR: At least 15 GiB of free disk is required for images, model, and data." >&2
  exit 4
fi

"${compose[@]}" config >/dev/null
"${compose[@]}" pull
"${compose[@]}" up -d ollama

ready=false
for _ in $(seq 1 90); do
  if "${compose[@]}" exec -T ollama ollama list >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
[[ "$ready" == true ]] || {
  echo "ERROR: Ollama did not become ready within three minutes." >&2
  exit 5
}

"${compose[@]}" --profile initialize run --rm model-init
"${compose[@]}" up -d open-webui
"${compose[@]}" ps

web_port="$(load_env_value WEB_PORT)"
echo "Open WebUI: http://127.0.0.1:${web_port}"
echo "Create the first account as the administrator. Keep loopback binding until TLS and access controls are configured."
echo "Apple Silicon note: Dockerized Ollama is CPU-compatible; Docker Desktop does not expose Metal acceleration to this Linux container."
