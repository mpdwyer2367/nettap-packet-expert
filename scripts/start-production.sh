#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

require_runtime
initialize_env
set_env_value DEPLOYMENT_MODE production
docker info >/dev/null 2>&1 || { echo "ERROR: Docker engine is not running." >&2; exit 3; }
stop_legacy_runtime_preserving_data
prepare_canonical_admin_bootstrap

[[ -f "${project_dir}/config/tls/tls.crt" && -f "${project_dir}/config/tls/tls.key" ]] || {
  echo "ERROR: Production TLS is not configured. Run ./scripts/configure-production.sh." >&2
  exit 8
}
require_digest_pins

effective_project="$(deployment_project_name)"
if [[ ! -f "$admin_finalized_file" ]] || \
  ! grep -Fqx "Compose project: $effective_project" "$admin_finalized_file"; then
  echo "Production access is blocked until the generated administrator credential is changed and finalized."
  initialize_model_with_temporary_egress bootstrap-local
  web_port="$(load_env_value WEB_PORT)"
  echo "Complete administrator activation at http://127.0.0.1:${web_port} using $bootstrap_password_file."
  echo "Then run ./scripts/finalize-admin.sh --confirm and rerun start-production.sh."
  exit 10
fi

"${script_dir}/production-preflight.sh"
"${compose_local[@]}" down >/dev/null 2>&1 || true
initialize_model_with_temporary_egress production
"${compose_production[@]}" up -d evidence-service gateway
"${compose_production[@]}" ps
hostname="$(load_env_value APPLIANCE_HOSTNAME)"
https_port="$(load_env_value HTTPS_PORT)"
echo "NetTAP Network Intelligence production candidate: https://${hostname}:${https_port}"
echo "Combined Network Observability & Packet Analysis UI: https://${hostname}:${https_port}/"
echo "Evidence parsing is an internal service and has no public route."
echo "Run ./scripts/verify-production-deployment.sh and complete the production acceptance record."
