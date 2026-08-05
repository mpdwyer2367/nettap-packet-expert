#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

require_runtime
initialize_env
mode="$(load_env_value DEPLOYMENT_MODE)"
if [[ "$mode" == production ]]; then
  "${compose_production[@]}" ps
  hostname="$(load_env_value APPLIANCE_HOSTNAME)"
  https_port="$(load_env_value HTTPS_PORT)"
  curl --fail --silent --show-error --cacert "${project_dir}/config/tls/tls.crt" \
    --resolve "${hostname}:${https_port}:127.0.0.1" "https://${hostname}:${https_port}/health" >/dev/null
  echo "Healthy: https://${hostname}:${https_port}"
else
  "${compose_local[@]}" ps
  web_port="$(load_env_value WEB_PORT)"
  curl --fail --silent --show-error "http://127.0.0.1:${web_port}/health" >/dev/null
  echo "Healthy: http://127.0.0.1:${web_port}"
fi
