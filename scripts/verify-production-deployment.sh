#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

require_runtime
initialize_env
require_digest_pins
[[ "$(load_env_value DEPLOYMENT_MODE)" == production ]] || { echo "FAIL: DEPLOYMENT_MODE is not production." >&2; exit 12; }
[[ -f "$admin_finalized_file" ]] || { echo "FAIL: Administrator activation is incomplete." >&2; exit 12; }
"${compose_production[@]}" config >/dev/null
for service in ollama open-webui gateway; do
  container_id="$("${compose_production[@]}" ps -q "$service")"
  [[ -n "$container_id" ]] || { echo "FAIL: $service is not running." >&2; exit 12; }
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
  [[ "$health" == healthy || "$health" == running ]] || { echo "FAIL: $service state is $health." >&2; exit 12; }
done
ollama_id="$("${compose_production[@]}" ps -q ollama)"
webui_id="$("${compose_production[@]}" ps -q open-webui)"
gateway_id="$("${compose_production[@]}" ps -q gateway)"
[[ -z "$(docker port "$ollama_id")" ]] || { echo "FAIL: Ollama is published on the host." >&2; exit 12; }
[[ -z "$(docker port "$webui_id")" ]] || { echo "FAIL: Open WebUI bypasses the TLS gateway." >&2; exit 12; }
published="$(docker port "$gateway_id")"
[[ "$published" == *"443/tcp"* ]] || { echo "FAIL: Gateway HTTPS is not published." >&2; exit 12; }
if docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$ollama_id" | grep -q 'model-egress'; then
  echo "FAIL: Ollama still has temporary registry egress." >&2
  exit 12
fi
model_name="$(load_env_value MODEL_NAME)"
"${compose_production[@]}" exec -T ollama ollama show "$model_name" >/dev/null
hostname="$(load_env_value APPLIANCE_HOSTNAME)"
https_port="$(load_env_value HTTPS_PORT)"
curl --fail --silent --show-error --cacert "${project_dir}/config/tls/tls.crt" \
  --resolve "${hostname}:${https_port}:127.0.0.1" "https://${hostname}:${https_port}/health" >/dev/null
output="${project_dir}/reports/generated/production-runtime-$(date -u +%Y%m%dT%H%M%SZ).txt"
mkdir -p "$(dirname "$output")"
{
  printf 'Result: PASS\n'
  printf 'Verified UTC: %s\n' "$(date -u +%FT%TZ)"
  printf 'Release: %s\n' "$(load_env_value RELEASE_VERSION)"
  printf 'Model: %s\n' "$model_name"
  printf 'Endpoint: https://%s:%s\n' "$hostname" "$https_port"
  printf 'Controls: TLS gateway, no direct Ollama/WebUI host ports, runtime model egress absent, healthy services\n'
} > "$output"
echo "Production runtime verification passed: $output"
