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

for service in ollama open-webui evidence-service gateway; do
  container_id="$("${compose_production[@]}" ps -q "$service")"
  [[ -n "$container_id" ]] || { echo "FAIL: $service is not running." >&2; exit 12; }
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
  [[ "$health" == healthy || "$health" == running ]] || { echo "FAIL: $service state is $health." >&2; exit 12; }
done
ollama_id="$("${compose_production[@]}" ps -q ollama)"
webui_id="$("${compose_production[@]}" ps -q open-webui)"
gateway_id="$("${compose_production[@]}" ps -q gateway)"
evidence_id="$("${compose_production[@]}" ps -q evidence-service)"
verify_container_control "$ollama_id" ollama "$(load_env_value OLLAMA_IMAGE)"
verify_container_control "$webui_id" open-webui "$(load_env_value OPEN_WEBUI_IMAGE)"
verify_container_control "$evidence_id" evidence-service "$(load_env_value OPEN_WEBUI_IMAGE)"
verify_container_control "$gateway_id" gateway "$(load_env_value CADDY_IMAGE)"
[[ -z "$(docker port "$ollama_id")" ]] || { echo "FAIL: Ollama is published on the host." >&2; exit 12; }
[[ -z "$(docker port "$webui_id")" ]] || { echo "FAIL: Open WebUI bypasses the TLS gateway." >&2; exit 12; }
[[ -z "$(docker port "$evidence_id")" ]] || { echo "FAIL: Evidence Workspace bypasses the TLS gateway." >&2; exit 12; }
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
nettap_name="$(load_env_value NETTAP_AI_MODEL)"
model_rows="$("${compose_production[@]}" exec -T ollama ollama list)"
legacy_models="$(printf '%s\n' "$model_rows" | awk -v current="$nettap_name" 'NR > 1 && $1 != current && ($1 ~ /^nettap-ai:/ || $1 ~ /^nettap-ai-backup-/ || $1 ~ /^nettap-packet-expert:/ || $1 ~ /^nettap-network-visibility:/) {print $1}')"
[[ -z "$legacy_models" ]] || {
  echo "FAIL: Superseded NetTAP model tags remain in the appliance store: $legacy_models" >&2
  exit 12
}
base_id="$(printf '%s\n' "$model_rows" | awk -v name="$base_name" '$1 == name {print $2}')"
nettap_id="$(printf '%s\n' "$model_rows" | awk -v name="$nettap_name" '$1 == name {print $2}')"
[[ "$base_id" == "$(load_env_value EXPECTED_BASE_MODEL_ID)" ]] || {
  echo "FAIL: Runtime base-model identity does not match the approved manifest." >&2
  exit 12
}
[[ -n "$nettap_id" ]] || { echo "FAIL: NetTAP Network Intelligence Model identity is unavailable." >&2; exit 12; }
model_lock="${project_dir}/reports/generated/model-lock.txt"
[[ -f "$model_lock" ]] || { echo "FAIL: Model identity record is missing." >&2; exit 12; }
grep -Fqx "NetTAP AI model ID: $nettap_id" "$model_lock" || {
  echo "FAIL: NetTAP AI identity differs from the initialization record." >&2
  exit 12
}
if ! "${compose_production[@]}" exec -T open-webui python - <<'PY'
import json
import hashlib
from pathlib import Path
embedding = json.loads(Path('/app/backend/data/nettap-embedding-model.json').read_text(encoding='utf-8'))
provisioning = json.loads(Path('/app/backend/data/nettap-provisioning-state.json').read_text(encoding='utf-8'))
assert embedding['revision'] == '1110a243fdf4706b3f48f1d95db1a4f5529b4d41'
assert embedding['model_path'] == '/app/backend/data/nettap-models/all-MiniLM-L6-v2/1110a243fdf4706b3f48f1d95db1a4f5529b4d41'
assert embedding['embedding_dimension'] > 0
aggregate = hashlib.sha256()
expected_files = set()
for item in embedding['files']:
    expected_files.add(item['path'])
    path = Path(embedding['model_path']) / item['path']
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    assert digest == item['sha256']
    aggregate.update(item['path'].encode('utf-8'))
    aggregate.update(b'\0')
    aggregate.update(digest.encode('ascii'))
    aggregate.update(b'\n')
actual_files = {
    path.relative_to(embedding['model_path']).as_posix()
    for path in Path(embedding['model_path']).rglob('*')
    if path.is_file() and '.cache' not in path.parts
}
assert actual_files == expected_files
assert aggregate.hexdigest() == embedding['aggregate_sha256']
assert provisioning['release_version'] == '0.4.0-rc.1'
assert provisioning['offline_rag']['result'] == 'PASS'
assert {item['id'] for item in provisioning['assistants']} == {
    'nettap-network-visibility', 'nettap-packet-expert'
}
assert set(provisioning['knowledge']) == {'shared', 'network_visibility', 'packet_expert'}
PY
then
  echo "FAIL: Managed assistant or offline RAG state is invalid." >&2
  exit 12
fi
[[ "$(installed_provisioning_fingerprint production)" == "$(provisioning_fingerprint production)" ]] || {
  echo "FAIL: Installed provisioning fingerprint differs from the RC4 source." >&2
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
visibility_redirect="$(curl --fail --silent --show-error --output /dev/null --write-out '%{redirect_url}' \
  --cacert "${project_dir}/config/tls/tls.crt" --resolve "${hostname}:${https_port}:127.0.0.1" \
  "https://${hostname}:${https_port}/visibility")"
packet_redirect="$(curl --fail --silent --show-error --output /dev/null --write-out '%{redirect_url}' \
  --cacert "${project_dir}/config/tls/tls.crt" --resolve "${hostname}:${https_port}:127.0.0.1" \
  "https://${hostname}:${https_port}/packet-expert")"
[[ "$visibility_redirect" == *'model=nettap-network-visibility'* ]] || {
  echo "FAIL: Production Network & Visibility route selected the wrong profile." >&2
  exit 12
}
[[ "$packet_redirect" == *'model=nettap-packet-expert'* ]] || {
  echo "FAIL: Production Packet Expert route selected the wrong profile." >&2
  exit 12
}
"${project_dir}/tests/evidence-runtime-e2e.sh" --production || {
  echo "FAIL: TLS-gateway Evidence Workspace runtime workflow failed." >&2
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
  printf 'NetTAP AI model: %s\n' "$nettap_name"
  printf 'Base model ID: %s\n' "$base_id"
  printf 'NetTAP AI model ID: %s\n' "$nettap_id"
  printf 'OLLAMA_IMAGE=%s\n' "$(load_env_value OLLAMA_IMAGE)"
  printf 'OPEN_WEBUI_IMAGE=%s\n' "$(load_env_value OPEN_WEBUI_IMAGE)"
  printf 'CADDY_IMAGE=%s\n' "$(load_env_value CADDY_IMAGE)"
  printf 'Endpoint: https://%s:%s\n' "$hostname" "$https_port"
  printf 'Evidence Workspace: https://%s:%s/evidence/\n' "$hostname" "$https_port"
  printf 'Controls: exact images, TLS/HSTS gateway, least privilege, exact gateway binding, no direct Ollama/WebUI/Evidence host ports, runtime model egress absent, locked shared base and Network Intelligence model identities, pinned offline embedding cache, managed assistant profiles and knowledge, offline RAG proof, authenticated evidence ingestion and deterministic analysis, healthy services\n'
} > "$output"
echo "Production runtime verification passed: $output"
