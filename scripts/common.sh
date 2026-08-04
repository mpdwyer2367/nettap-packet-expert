#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${project_dir}/.env"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: Required command not found: $1" >&2
    exit 3
  }
}

require_runtime() {
  require_command docker
  docker compose version >/dev/null 2>&1 || {
    echo "ERROR: Docker Compose v2 is required." >&2
    exit 3
  }
}

initialize_env() {
  require_command openssl
  if [[ ! -f "$env_file" ]]; then
    cp "${project_dir}/.env.example" "$env_file"
    chmod 0600 "$env_file"
  fi
  if grep -q '^WEBUI_SECRET_KEY=GENERATE_ON_FIRST_START$' "$env_file"; then
    local secret temporary
    secret="$(openssl rand -hex 32)"
    temporary="${env_file}.new"
    sed "s/^WEBUI_SECRET_KEY=GENERATE_ON_FIRST_START$/WEBUI_SECRET_KEY=${secret}/" "$env_file" > "$temporary"
    chmod 0600 "$temporary"
    mv "$temporary" "$env_file"
    unset secret
  fi
}

load_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$env_file" | tail -n 1
}

compose=(docker compose --project-directory "$project_dir" --env-file "$env_file" -f "${project_dir}/compose.yaml")
