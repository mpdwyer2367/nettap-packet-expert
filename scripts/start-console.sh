#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

# shellcheck source=scripts/common.sh
source scripts/common.sh
initialize_env

required=(SUPABASE_URL SUPABASE_WSS_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY)
for key in "${required[@]}"; do
  value="$(load_env_value "$key")"
  if [[ -z "$value" || "$value" == GENERATE_ON_FIRST_START || "$value" == CHANGE_ME ]]; then
    echo "ERROR: $key must be configured before starting the pre-production console." >&2
    exit 12
  fi
done

supabase_url="$(load_env_value SUPABASE_URL)"
supabase_wss_url="$(load_env_value SUPABASE_WSS_URL)"
if [[ ! "$supabase_url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]]; then
  echo "ERROR: SUPABASE_URL must be an HTTPS origin without a path." >&2
  exit 12
fi
if [[ ! "$supabase_wss_url" =~ ^wss://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]]; then
  echo "ERROR: SUPABASE_WSS_URL must be a WSS origin without a path." >&2
  exit 12
fi

if [[ "$(load_env_value NETTAP_AI_MODEL)" != "nettap-ai:0.4.0-rc.1" ]]; then
  echo "ERROR: the console release contract requires nettap-ai:0.4.0-rc.1." >&2
  exit 12
fi

docker compose \
  --env-file .env \
  -f compose.yaml \
  -f compose.production.yaml \
  -f compose.console.yaml \
  up -d --build ollama analyst-console console-gateway

echo "Pre-production NetTAP analyst console: https://$(load_env_value APPLIANCE_HOSTNAME):$(load_env_value CONSOLE_HTTPS_PORT)"
