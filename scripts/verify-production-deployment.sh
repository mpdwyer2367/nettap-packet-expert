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

verify_container_control() {
  local container_id="$1" service="$2" expected_image="$3" actual_image security_options cap_drop
  actual_image="$(docker inspect --format '{{.Config.Image}}' "$container_id")"
  [[ "$actual_image" == "$expected_image" ]] || {
    echo "FAIL: $service runs $actual_image instead of approved image $expected_image." >&2
    exit 12
  }
  security_options="$(docker inspect --format '{{range .HostConfig.SecurityOpt}}{{println .}}{{end}}' "$container_id")"
  printf '%s\n' "$security_options" | grep -Fqx 'no-new-privileges:true' || {
    echo "FAIL: $service does not enforce no-new-privileges." >&2
    exit 12
  }
  cap_drop="$(docker inspect --format '{{range .HostConfig.CapDrop}}{{println .}}{{end}}' "$container_id")"
  printf '%s\n' "$cap_drop" | grep -Fq 'ALL' || {
    echo "FAIL: $service does not drop all capabilities by default." >&2
    exit 12
  }
}

for service in ollama open-webui gateway; do
  container_id="$("${compose_production[@]}" ps -q "$service")"
  [[ -n "$container_id" ]] || { echo "FAIL: $service is not running." >&2; exit 12; }
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
  [[ "$health" == healthy || "$health" == running ]] || { echo "FAIL: $service state is $health." >&2; exit 12; }
done
ollama_id="$("${compose_production[@]}" ps -q ollama)"
webui_id="$("${compose_production[@]}" ps -q open-webui)"
gateway_id="$("${compose_production[@]}" ps -q gateway)"
verify_container_control "$ollama_id" ollama "$(load_env_value OLLAMA_IMAGE)"
verify_container_control "$webui_id" open-webui "$(load_env_value OPEN_WEBUI_IMAGE)"
verify_container_control "$gateway_id" gateway "$(load_env_value CADDY_IMAGE)"
[[ -z "$(docker port "$ollama_id")" ]] || { echo "FAIL: Ollama is published on the host." >&2; exit 12; }
[[ -z "$(docker port "$webui_id")" ]] || { echo "FAIL: Open WebUI bypasses the TLS gateway." >&2; exit 12; }
published="$(docker inspect --format '{{range $port, $bindings := .HostConfig.PortBindings}}{{printf "%s=" $port}}{{range $bindings}}{{printf "%s:%s" .HostIp .HostPort}}{{end}}{{println}}{{end}}' "$gateway_id")"
expected_binding="443/tcp=$(load_env_value HTTPS_BIND_ADDRESS):$(load_env_value HTTPS_PORT)"
[[ "$published" == "$expected_binding" ]] || {
  echo "FAIL: Gateway binding is '$published'; expected only '$expected_binding'." >&2
  exit 12
}
if docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$ollama_id" | grep -q 'model-egress'; then
  echo "FAIL: Ollama still has temporary registry egress." >&2
  exit 12
fi
base_name="$(load_env_value BASE_MODEL)"
visibility_name="$(load_env_value NETWORK_VISIBILITY_MODEL)"
packet_name="$(load_env_value PACKET_EXPERT_MODEL)"
model_rows="$("${compose_production[@]}" exec -T ollama ollama list)"
base_id="$(printf '%s\n' "$model_rows" | awk -v name="$base_name" '$1 == name {print $2}')"
visibility_id="$(printf '%s\n' "$model_rows" | awk -v name="$visibility_name" '$1 == name {print $2}')"
packet_id="$(printf '%s\n' "$model_rows" | awk -v name="$packet_name" '$1 == name {print $2}')"
[[ "$base_id" == "$(load_env_value EXPECTED_BASE_MODEL_ID)" ]] || {
  echo "FAIL: Runtime base-model identity does not match the approved manifest." >&2
  exit 12
}
[[ -n "$visibility_id" ]] || { echo "FAIL: Network & Visibility model identity is unavailable." >&2; exit 12; }
[[ -n "$packet_id" ]] || { echo "FAIL: Packet Expert model identity is unavailable." >&2; exit 12; }
model_lock="${project_dir}/reports/generated/model-lock.txt"
[[ -f "$model_lock" ]] || { echo "FAIL: Model identity record is missing." >&2; exit 12; }
grep -Fqx "Network Visibility model ID: $visibility_id" "$model_lock" || {
  echo "FAIL: Network & Visibility identity differs from the initialization record." >&2
  exit 12
}
grep -Fqx "Packet Expert model ID: $packet_id" "$model_lock" || {
  echo "FAIL: Packet Expert identity differs from the initialization record." >&2
  exit 12
}
hostname="$(load_env_value APPLIANCE_HOSTNAME)"
https_port="$(load_env_value HTTPS_PORT)"
headers_file="$(mktemp "${TMPDIR:-/tmp}/nettap-headers.XXXXXX")"
trap 'rm -f "$headers_file"' EXIT
curl --fail --silent --show-error --dump-header "$headers_file" --output /dev/null \
  --cacert "${project_dir}/config/tls/tls.crt" \
  --resolve "${hostname}:${https_port}:127.0.0.1" "https://${hostname}:${https_port}/health"
grep -Eiq '^strict-transport-security:[[:space:]]*max-age=31536000; includeSubDomains[[:space:]]*$' "$headers_file" || {
  echo "FAIL: HTTPS response is missing the required HSTS policy." >&2
  exit 12
}
rm -f "$headers_file"
trap - EXIT
output="${project_dir}/reports/generated/production-runtime-$(date -u +%Y%m%dT%H%M%SZ).txt"
mkdir -p "$(dirname "$output")"
{
  printf 'Result: PASS\n'
  printf 'Verified UTC: %s\n' "$(date -u +%FT%TZ)"
  printf 'Release: %s\n' "$(load_env_value RELEASE_VERSION)"
  printf 'Network Visibility model: %s\n' "$visibility_name"
  printf 'Packet Expert model: %s\n' "$packet_name"
  printf 'Base model ID: %s\n' "$base_id"
  printf 'Network Visibility model ID: %s\n' "$visibility_id"
  printf 'Packet Expert model ID: %s\n' "$packet_id"
  printf 'OLLAMA_IMAGE=%s\n' "$(load_env_value OLLAMA_IMAGE)"
  printf 'OPEN_WEBUI_IMAGE=%s\n' "$(load_env_value OPEN_WEBUI_IMAGE)"
  printf 'CADDY_IMAGE=%s\n' "$(load_env_value CADDY_IMAGE)"
  printf 'Endpoint: https://%s:%s\n' "$hostname" "$https_port"
  printf 'Controls: exact images, TLS/HSTS gateway, least privilege, exact gateway binding, no direct Ollama/WebUI host ports, runtime model egress absent, shared base identity, two locked assistant identities, healthy services\n'
} > "$output"
echo "Production runtime verification passed: $output"
