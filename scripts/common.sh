#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${project_dir}/.env"
bootstrap_password_file="${project_dir}/.bootstrap-admin-password"
evidence_token_file="${project_dir}/.evidence-api-token"
# shellcheck disable=SC2034 # exported to scripts that source this library
admin_finalized_file="${project_dir}/.admin-bootstrap-finalized"
canonical_project_name="nettap-network-intelligence"
legacy_project_name="nettap-packet-expert"

deployment_project_name() {
  printf '%s\n' "${COMPOSE_PROJECT_NAME:-$canonical_project_name}"
}

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
  fi
  chmod 0600 "$env_file"
  ensure_env_default RELEASE_VERSION "0.3.0-rc.5"
  ensure_env_default OLLAMA_IMAGE "ollama/ollama:0.32.5"
  ensure_env_default OPEN_WEBUI_IMAGE "ghcr.io/open-webui/open-webui:v0.11.0"
  ensure_env_default CADDY_IMAGE "caddy:2.11.4-alpine"
  ensure_env_default BACKUP_IMAGE "alpine:3.24.1"
  ensure_env_default BASE_MODEL "qwen2.5:7b-instruct-q4_K_M"
  ensure_env_default NETTAP_AI_MODEL "nettap-ai:0.3.0-rc.5"
  ensure_env_default MODEL_NAME "nettap-ai:0.3.0-rc.5"
  ensure_env_default EXPECTED_BASE_MODEL_ID "845dbda0ea48"
  ensure_env_default RETIRE_LEGACY_NETTAP_MODELS "true"
  ensure_env_default NETTAP_VISIBILITY_PROFILE "nettap-network-visibility"
  ensure_env_default NETTAP_PACKET_EXPERT_PROFILE "nettap-packet-expert"
  ensure_env_default RAG_EMBEDDING_MODEL_ID "sentence-transformers/all-MiniLM-L6-v2"
  ensure_env_default RAG_EMBEDDING_MODEL_REVISION "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
  ensure_env_default RAG_EMBEDDING_MODEL "/app/backend/data/nettap-models/all-MiniLM-L6-v2/1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
  ensure_env_default DEPLOYMENT_MODE "local"
  ensure_env_default BIND_ADDRESS "127.0.0.1"
  ensure_env_default WEB_PORT "3100"
  ensure_env_default VISIBILITY_LAUNCHER_PORT "3000"
  ensure_env_default PACKET_EXPERT_LAUNCHER_PORT "3001"
  ensure_env_default EVIDENCE_PORT "3200"
  ensure_env_default HTTPS_BIND_ADDRESS "0.0.0.0"
  ensure_env_default HTTPS_PORT "8443"
  ensure_env_default APPLIANCE_HOSTNAME "nettap-ai.local"
  ensure_env_default WEBUI_SECRET_KEY "GENERATE_ON_FIRST_START"
  ensure_env_default JWT_EXPIRES_IN "8h"
  ensure_env_default OLLAMA_CPUS "6"
  ensure_env_default OLLAMA_MEMORY "8g"
  ensure_env_default WEBUI_CPUS "2"
  ensure_env_default WEBUI_MEMORY "3g"
  ensure_env_default EVIDENCE_CPUS "1"
  ensure_env_default EVIDENCE_MEMORY "512m"
  ensure_env_default EVIDENCE_MAX_UPLOAD_BYTES "52428800"
  ensure_env_default EVIDENCE_MAX_RECORDS "100000"
  ensure_env_default GATEWAY_CPUS "1"
  ensure_env_default GATEWAY_MEMORY "512m"
  if grep -Eq '^RELEASE_VERSION=(0\.2\.0-rc\.1|0\.3\.0-rc\.[1234])$' "$env_file"; then
    set_env_value RELEASE_VERSION "0.3.0-rc.5"
    if grep -q '^WEB_PORT=3001$' "$env_file"; then set_env_value WEB_PORT "3100"; fi
    if grep -q '^APPLIANCE_HOSTNAME=packet-expert.local$' "$env_file"; then
      set_env_value APPLIANCE_HOSTNAME "nettap-ai.local"
    fi
  fi
  if grep -Eq '^MODEL_NAME=(nettap-packet-expert:(0\.1\.0-rc\.8|0\.2\.0-rc\.1|0\.3\.0-rc\.1)|nettap-ai:(latest|0\.3\.0-rc\.[1234]))$' "$env_file"; then
    set_env_value MODEL_NAME "nettap-ai:0.3.0-rc.5"
  fi
  if grep -Eq '^NETTAP_AI_MODEL=(nettap-packet-expert:[^[:space:]]+|nettap-ai:(latest|0\.3\.0-rc\.[1234]))$' "$env_file"; then
    set_env_value NETTAP_AI_MODEL "nettap-ai:0.3.0-rc.5"
  fi
  if grep -q '^RAG_EMBEDDING_MODEL=/app/backend/data/nettap-models/all-MiniLM-L6-v2$' "$env_file"; then
    set_env_value RAG_EMBEDDING_MODEL "/app/backend/data/nettap-models/all-MiniLM-L6-v2/1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
  fi
  if grep -q '^WEBUI_ADMIN_PASSWORD=admin$' "$env_file"; then
    set_env_value WEBUI_ADMIN_PASSWORD "GENERATE_ON_FIRST_START"
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

  ensure_env_default WEBUI_ADMIN_NAME "NetTAP Administrator"
  ensure_env_default WEBUI_ADMIN_EMAIL "admin@nettap.local"
  ensure_env_default WEBUI_ADMIN_PASSWORD "GENERATE_ON_FIRST_START"
  ensure_env_default EVIDENCE_API_TOKEN "GENERATE_ON_FIRST_START"
  if grep -q '^WEBUI_ADMIN_PASSWORD=GENERATE_ON_FIRST_START$' "$env_file"; then
    local admin_password
    admin_password="Ntp!9$(openssl rand -hex 12)"
    set_env_value WEBUI_ADMIN_PASSWORD "$admin_password"
    umask 077
    {
      printf 'Login: %s\n' "$(load_env_value WEBUI_ADMIN_EMAIL)"
      printf 'Bootstrap password: %s\n' "$admin_password"
      printf 'Generated UTC: %s\n' "$(date -u +%FT%TZ)"
    } > "$bootstrap_password_file"
    chmod 0600 "$bootstrap_password_file"
    unset admin_password
  fi
  if grep -q '^EVIDENCE_API_TOKEN=GENERATE_ON_FIRST_START$' "$env_file"; then
    local evidence_token
    evidence_token="$(openssl rand -hex 32)"
    set_env_value EVIDENCE_API_TOKEN "$evidence_token"
    umask 077
    {
      printf 'Bearer token: %s\n' "$evidence_token"
      printf 'Generated UTC: %s\n' "$(date -u +%FT%TZ)"
    } > "$evidence_token_file"
    chmod 0600 "$evidence_token_file"
    unset evidence_token
  fi
}

ensure_env_default() {
  local key="$1" value="$2"
  if ! grep -q "^${key}=" "$env_file"; then
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}

set_env_value() {
  local key="$1" value="$2" temporary
  temporary="${env_file}.new"
  if grep -q "^${key}=" "$env_file"; then
    awk -v key="$key" -v value="$value" '
      BEGIN { prefix = key "=" }
      index($0, prefix) == 1 { print prefix value; next }
      { print }
    ' "$env_file" > "$temporary"
  else
    cp "$env_file" "$temporary"
    printf '%s=%s\n' "$key" "$value" >> "$temporary"
  fi
  chmod 0600 "$temporary"
  mv "$temporary" "$env_file"
}

load_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$env_file" | tail -n 1
}

compose_base=(docker compose --project-directory "$project_dir" --env-file "$env_file" -f "${project_dir}/compose.yaml")
compose_local=("${compose_base[@]}" -f "${project_dir}/compose.local.yaml")
compose_local_bootstrap=("${compose_local[@]}" -f "${project_dir}/compose.bootstrap.yaml")
compose_production=("${compose_base[@]}" -f "${project_dir}/compose.production.yaml")
compose_production_bootstrap=("${compose_production[@]}" -f "${project_dir}/compose.bootstrap.yaml")
compose_legacy_local=(docker compose --project-name "$legacy_project_name" --project-directory "$project_dir" \
  --env-file "$env_file" -f "${project_dir}/compose.yaml" -f "${project_dir}/compose.local.yaml")
# shellcheck disable=SC2034 # compatibility alias consumed by local test entry points
compose=("${compose_local[@]}")

local_runtime_diagnostics() {
  echo "NetTAP local runtime diagnostics:" >&2
  "${compose_local[@]}" ps >&2 || true
  for service in open-webui evidence-service assistant-launcher; do
    echo "--- ${service} logs ---" >&2
    "${compose_local[@]}" logs --no-color --tail=40 "$service" >&2 || true
  done
}

require_local_port_binding() {
  local service="$1" container_port="$2" expected="$3" container_id actual
  container_id="$("${compose_local[@]}" ps -q "$service")"
  [[ -n "$container_id" ]] || {
    echo "ERROR: ${service} has no container after recreation." >&2
    return 1
  }
  actual="$(docker port "$container_id" "${container_port}/tcp" 2>/dev/null || true)"
  [[ "$actual" == "$expected" ]] || {
    echo "ERROR: ${service} port ${container_port}/tcp is '${actual:-unpublished}'; expected ${expected}." >&2
    return 1
  }
}

wait_for_local_endpoint() {
  local label="$1" url="$2"
  local attempt
  for attempt in $(seq 1 60); do
    if curl --fail --silent --show-error "$url" >/dev/null 2>&1; then
      echo "PASS: ${label} is reachable at ${url}"
      return 0
    fi
    sleep 2
  done
  echo "ERROR: ${label} did not become reachable at ${url} within 120 seconds." >&2
  return 1
}

verify_local_runtime_access() {
  local bind_address web_port visibility_port packet_port evidence_port
  require_command curl
  bind_address="$(load_env_value BIND_ADDRESS)"
  web_port="$(load_env_value WEB_PORT)"
  visibility_port="$(load_env_value VISIBILITY_LAUNCHER_PORT)"
  packet_port="$(load_env_value PACKET_EXPERT_LAUNCHER_PORT)"
  evidence_port="$(load_env_value EVIDENCE_PORT)"
  [[ "$bind_address" == "127.0.0.1" ]] || {
    echo "ERROR: Local deployment requires BIND_ADDRESS=127.0.0.1; received ${bind_address}." >&2
    return 1
  }
  require_local_port_binding open-webui 8080 "${bind_address}:${web_port}" || return 1
  require_local_port_binding evidence-service 8081 "${bind_address}:${evidence_port}" || return 1
  require_local_port_binding assistant-launcher 3000 "${bind_address}:${visibility_port}" || return 1
  require_local_port_binding assistant-launcher 3001 "${bind_address}:${packet_port}" || return 1
  wait_for_local_endpoint "Open WebUI" "http://${bind_address}:${web_port}/health" || return 1
  wait_for_local_endpoint "Evidence Workspace" "http://${bind_address}:${evidence_port}/health" || return 1
  wait_for_local_endpoint "Network & Visibility" "http://${bind_address}:${visibility_port}/system/health" || return 1
  wait_for_local_endpoint "Packet Expert" "http://${bind_address}:${packet_port}/system/health" || return 1
}

recreate_local_interfaces() {
  "${compose_local[@]}" config >/dev/null || {
    echo "ERROR: The merged local Compose configuration is invalid." >&2
    return 1
  }
  "${compose_local[@]}" up -d --force-recreate open-webui evidence-service assistant-launcher || {
    local_runtime_diagnostics
    return 1
  }
  verify_local_runtime_access || {
    local_runtime_diagnostics
    return 1
  }
}

stop_legacy_runtime_preserving_data() {
  local effective_project legacy_ids
  effective_project="$(deployment_project_name)"
  if [[ "$effective_project" != "$canonical_project_name" ]]; then
    return 0
  fi
  legacy_ids="$(docker ps -aq --filter "label=com.docker.compose.project=${legacy_project_name}")"
  if [[ -n "$legacy_ids" ]]; then
    echo "Stopping legacy ${legacy_project_name} containers; legacy volumes are preserved for controlled migration."
    "${compose_legacy_local[@]}" down --remove-orphans
  fi
}

prepare_canonical_admin_bootstrap() {
  local effective_project canonical_volume password admin_password
  effective_project="$(deployment_project_name)"
  canonical_volume="${effective_project}_packet-expert-open-webui-data"
  if docker volume inspect "$canonical_volume" >/dev/null 2>&1; then
    return 0
  fi

  set_env_value WEBUI_ADMIN_NAME "NetTAP Administrator"
  set_env_value WEBUI_ADMIN_EMAIL "admin@nettap.local"
  password="$(load_env_value WEBUI_ADMIN_PASSWORD)"
  if [[ -z "$password" || "$password" == BOOTSTRAP_RETIRED || \
    "$password" == GENERATE_ON_FIRST_START || ! -s "$bootstrap_password_file" ]] || \
    ! grep -Fqx "Compose project: $effective_project" "$bootstrap_password_file"; then
    admin_password="Ntp!9$(openssl rand -hex 12)"
    set_env_value WEBUI_ADMIN_PASSWORD "$admin_password"
    umask 077
    {
      printf 'Login: admin@nettap.local\n'
      printf 'Bootstrap password: %s\n' "$admin_password"
      printf 'Generated UTC: %s\n' "$(date -u +%FT%TZ)"
      printf 'Compose project: %s\n' "$effective_project"
    } > "$bootstrap_password_file"
    chmod 0600 "$bootstrap_password_file"
    unset admin_password
  fi
  rm -f "$admin_finalized_file"
}

wait_for_ollama_local_bootstrap() {
  local ready=false
  for _ in $(seq 1 90); do
    if "${compose_local_bootstrap[@]}" exec -T ollama ollama list >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 2
  done
  [[ "$ready" == true ]] || {
    echo "ERROR: Ollama did not become ready within three minutes." >&2
    return 5
  }
}

wait_for_ollama_production_bootstrap() {
  local ready=false
  for _ in $(seq 1 90); do
    if "${compose_production_bootstrap[@]}" exec -T ollama ollama list >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 2
  done
  [[ "$ready" == true ]] || {
    echo "ERROR: Ollama did not become ready within three minutes." >&2
    return 5
  }
}

recover_failed_model_initialization() {
  local mode="$1" was_running="$2"
  if [[ "$mode" == production ]]; then
    "${compose_production_bootstrap[@]}" down >/dev/null 2>&1 || true
    if [[ "$was_running" == true ]]; then
      "${compose_production[@]}" up -d ollama open-webui evidence-service gateway || true
    fi
  else
    "${compose_local_bootstrap[@]}" down >/dev/null 2>&1 || true
    if [[ "$was_running" == true ]]; then
      "${compose_local[@]}" up -d ollama open-webui evidence-service assistant-launcher || true
    fi
  fi
  echo "ERROR: Model initialization failed. Temporary registry egress was removed; any prior runtime restart was attempted." >&2
  echo "Recovery: correct the reported cause, then rerun the platform start command. Cached model downloads are reused." >&2
  exit 9
}

recover_failed_assistant_provisioning() {
  local mode="$1"
  if [[ "$mode" == production ]]; then
    "${compose_production_bootstrap[@]}" down >/dev/null 2>&1 || true
    "${compose_production[@]}" up -d ollama open-webui || true
  else
    "${compose_local_bootstrap[@]}" down >/dev/null 2>&1 || true
    "${compose_local[@]}" up -d ollama open-webui || true
  fi
  echo "ERROR: Assistant provisioning failed. Temporary registry egress was removed." >&2
  echo "Core Ollama and Open WebUI services were restarted for diagnosis; assistant launchers remain disabled." >&2
  echo "Correct the provisioning error shown above, then rerun the platform start command. Cached model downloads are reused." >&2
  exit 10
}

extract_provisioning_fingerprint() {
  local line candidate=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    if [[ ${#line} -eq 64 && "$line" != *[!0-9a-f]* ]]; then
      if [[ -n "$candidate" && "$candidate" != "$line" ]]; then
        echo "ERROR: Conflicting provisioning fingerprints were returned by Docker Compose." >&2
        return 7
      fi
      candidate="$line"
    fi
  done
  [[ -n "$candidate" ]] || return 1
  printf '%s\n' "$candidate"
}

provisioning_fingerprint() {
  local raw fingerprint
  local -a selected=("${compose_local[@]}")
  if [[ "$1" == production ]]; then selected=("${compose_production[@]}"); fi
  if ! raw="$("${selected[@]}" --profile provision run --rm --no-deps assistant-provisioner --fingerprint 2>&1)"; then
    printf '%s\n' "$raw" >&2
    echo "ERROR: Unable to calculate the assistant provisioning fingerprint." >&2
    return 7
  fi
  if ! fingerprint="$(printf '%s\n' "$raw" | extract_provisioning_fingerprint)"; then
    printf '%s\n' "$raw" >&2
    echo "ERROR: Docker Compose did not return one valid assistant provisioning fingerprint." >&2
    return 7
  fi
  printf '%s\n' "$fingerprint"
}

installed_provisioning_fingerprint() {
  local raw fingerprint status
  local -a selected=("${compose_local[@]}")
  if [[ "$1" == production ]]; then selected=("${compose_production[@]}"); fi
  if ! raw="$("${selected[@]}" exec -T open-webui python - 2>&1 <<'PY'
import json
from pathlib import Path
path = Path('/app/backend/data/nettap-provisioning-state.json')
try:
    print(json.loads(path.read_text(encoding='utf-8')).get('fingerprint', ''))
except (OSError, ValueError):
    print('')
PY
)"; then
    printf '%s\n' "$raw" >&2
    echo "ERROR: Unable to read the installed assistant provisioning fingerprint." >&2
    return 7
  fi
  if fingerprint="$(printf '%s\n' "$raw" | extract_provisioning_fingerprint)"; then
    printf '%s\n' "$fingerprint"
  else
    status=$?
    if [[ $status -eq 1 ]]; then
      printf '\n'
    else
      return "$status"
    fi
  fi
}

provision_assistants() {
  local mode="$1" desired actual password provision_status admin_email entered_email
  local -a selected=("${compose_local[@]}")
  if [[ "$mode" == production ]]; then selected=("${compose_production[@]}"); fi
  desired="$(provisioning_fingerprint "$mode")"
  actual="$(installed_provisioning_fingerprint "$mode")"
  if [[ -n "$actual" && "$actual" == "$desired" ]]; then
    echo "Assistant profiles and offline RAG already match this release."
    return 0
  fi

  admin_email="$(load_env_value WEBUI_ADMIN_EMAIL)"
  password="$(load_env_value WEBUI_ADMIN_PASSWORD)"
  if [[ -z "$password" || "$password" == BOOTSTRAP_RETIRED || "$password" == GENERATE_ON_FIRST_START ]]; then
    [[ -t 0 ]] || {
      echo "ERROR: Assistant provisioning changed and requires the current Open WebUI administrator password." >&2
      echo "Run ./scripts/provision-assistants.sh --confirm from an interactive terminal." >&2
      return 7
    }
    printf 'Current Open WebUI administrator email [%s]: ' "$admin_email" >&2
    IFS= read -r entered_email
    if [[ -n "$entered_email" ]]; then admin_email="$entered_email"; fi
    printf 'Current Open WebUI administrator password: ' >&2
    IFS= read -r -s password
    printf '\n' >&2
  fi
  [[ -n "$password" ]] || { echo "ERROR: Administrator password is empty." >&2; return 7; }
  [[ -n "$admin_email" ]] || { echo "ERROR: Administrator email is empty." >&2; return 7; }
  if printf '%s\n' "$password" | "${selected[@]}" --profile provision run --rm -T \
    -e "WEBUI_ADMIN_EMAIL=$admin_email" assistant-provisioner; then
    provision_status=0
  else
    provision_status=$?
  fi
  if [[ $provision_status -eq 11 ]]; then
    unset password
    [[ -t 0 ]] || {
      echo "ERROR: The stored bootstrap identity does not match this existing Open WebUI volume." >&2
      echo "Run ./scripts/provision-assistants.sh --confirm from an interactive terminal and enter the current administrator email and password." >&2
      return 7
    }
    echo "The existing Open WebUI volume retained a different administrator identity." >&2
    printf 'Current Open WebUI administrator email [%s]: ' "$admin_email" >&2
    IFS= read -r entered_email
    if [[ -n "$entered_email" ]]; then admin_email="$entered_email"; fi
    [[ -n "$admin_email" ]] || { echo "ERROR: Administrator email is empty." >&2; return 7; }
    printf 'Current Open WebUI administrator password: ' >&2
    IFS= read -r -s password
    printf '\n' >&2
    [[ -n "$password" ]] || { echo "ERROR: Administrator password is empty." >&2; return 7; }
    if printf '%s\n' "$password" | "${selected[@]}" --profile provision run --rm -T \
      -e "WEBUI_ADMIN_EMAIL=$admin_email" assistant-provisioner; then
      provision_status=0
    else
      provision_status=$?
    fi
  fi
  unset password
  if [[ $provision_status -ne 0 ]]; then
    if [[ $provision_status -eq 11 ]]; then
      echo "ERROR: Open WebUI rejected the current administrator email or password." >&2
      echo "Recovery: run ./scripts/recover-admin.sh --confirm, then rerun the platform start command." >&2
    else
      echo "ERROR: Automatic assistant and offline RAG provisioning failed; review the provisioner error above." >&2
    fi
    return 7
  fi
  actual="$(installed_provisioning_fingerprint "$mode")"
  [[ "$actual" == "$desired" ]] || {
    echo "ERROR: Assistant provisioning state does not match the release fingerprint." >&2
    echo "Expected fingerprint: $desired" >&2
    echo "Installed fingerprint: ${actual:-<unavailable>}" >&2
    return 7
  }
}

retire_legacy_models_if_enabled() {
  local enabled
  enabled="$(load_env_value RETIRE_LEGACY_NETTAP_MODELS)"
  case "$enabled" in
    true|TRUE|1|yes|YES)
      "${project_dir}/scripts/retire-legacy-models.sh" --confirm
      ;;
    false|FALSE|0|no|NO)
      echo "Legacy NetTAP model retirement is disabled by RETIRE_LEGACY_NETTAP_MODELS=$enabled."
      ;;
    *)
      echo "ERROR: RETIRE_LEGACY_NETTAP_MODELS must be true or false; received: $enabled" >&2
      return 7
      ;;
  esac
}

initialize_model_with_temporary_egress() {
  local runtime_name="$1" was_running=false
  case "$runtime_name" in
    local|bootstrap-local)
      if [[ -n "$("${compose_local[@]}" ps -q open-webui 2>/dev/null)" ]]; then was_running=true; fi
      "${compose_local[@]}" down >/dev/null 2>&1 || true
      "${compose_local_bootstrap[@]}" config >/dev/null || recover_failed_model_initialization local "$was_running"
      "${compose_local_bootstrap[@]}" pull || recover_failed_model_initialization local "$was_running"
      "${compose_local_bootstrap[@]}" up -d ollama || recover_failed_model_initialization local "$was_running"
      wait_for_ollama_local_bootstrap || recover_failed_model_initialization local "$was_running"
      "${compose_local_bootstrap[@]}" --profile initialize run --rm model-init || recover_failed_model_initialization local "$was_running"
      "${compose_local_bootstrap[@]}" --profile initialize run --rm rag-cache-init || recover_failed_model_initialization local "$was_running"
      "${compose_local_bootstrap[@]}" down || recover_failed_model_initialization local "$was_running"
      "${compose_local[@]}" up -d ollama open-webui
      record_model_identity local
      provision_assistants local || recover_failed_assistant_provisioning local
      recreate_local_interfaces || recover_failed_assistant_provisioning local
      retire_legacy_models_if_enabled || recover_failed_model_initialization local "$was_running"
      ;;
    production)
      if [[ -n "$("${compose_production[@]}" ps -q open-webui 2>/dev/null)" ]]; then was_running=true; fi
      "${compose_production[@]}" down >/dev/null 2>&1 || true
      "${compose_production_bootstrap[@]}" config >/dev/null || recover_failed_model_initialization production "$was_running"
      "${compose_production_bootstrap[@]}" pull || recover_failed_model_initialization production "$was_running"
      "${compose_production_bootstrap[@]}" up -d ollama || recover_failed_model_initialization production "$was_running"
      wait_for_ollama_production_bootstrap || recover_failed_model_initialization production "$was_running"
      "${compose_production_bootstrap[@]}" --profile initialize run --rm model-init || recover_failed_model_initialization production "$was_running"
      "${compose_production_bootstrap[@]}" --profile initialize run --rm rag-cache-init || recover_failed_model_initialization production "$was_running"
      "${compose_production_bootstrap[@]}" down || recover_failed_model_initialization production "$was_running"
      "${compose_production[@]}" up -d ollama open-webui
      record_model_identity production
      provision_assistants production || recover_failed_assistant_provisioning production
      retire_legacy_models_if_enabled || recover_failed_model_initialization production "$was_running"
      ;;
    *)
      echo "ERROR: Unknown deployment mode: $runtime_name" >&2
      exit 2
      ;;
  esac
  echo "Model initialization complete; registry egress was removed from the ${runtime_name} runtime."
}

record_model_identity() {
  local mode="$1" rows base_id nettap_id expected_id base_name nettap_name
  expected_id="$(load_env_value EXPECTED_BASE_MODEL_ID)"
  base_name="$(load_env_value BASE_MODEL)"
  nettap_name="$(load_env_value NETTAP_AI_MODEL)"
  if [[ "$mode" == production ]]; then
    rows="$("${compose_production[@]}" exec -T ollama ollama list)"
  else
    rows="$("${compose_local[@]}" exec -T ollama ollama list)"
  fi
  base_id="$(printf '%s\n' "$rows" | awk -v name="$base_name" '$1 == name {print $2}')"
  nettap_id="$(printf '%s\n' "$rows" | awk -v name="$nettap_name" '$1 == name {print $2}')"
  [[ "$base_id" == "$expected_id" ]] || {
    echo "ERROR: Base-model identity is $base_id; expected $expected_id. Release review is required." >&2
    exit 9
  }
  [[ -n "$nettap_id" ]] || { echo "ERROR: NetTAP Network Intelligence Model identity is unavailable." >&2; exit 9; }
  mkdir -p "${project_dir}/reports/generated"
  {
    printf 'Recorded UTC: %s\n' "$(date -u +%FT%TZ)"
    printf 'Base model: %s\n' "$base_name"
    printf 'Base model ID: %s\n' "$base_id"
    printf 'NetTAP AI model: %s\n' "$nettap_name"
    printf 'NetTAP AI model ID: %s\n' "$nettap_id"
  } > "${project_dir}/reports/generated/model-lock.txt"
}

require_digest_pins() {
  local key value
  for key in OLLAMA_IMAGE OPEN_WEBUI_IMAGE CADDY_IMAGE BACKUP_IMAGE; do
    value="$(load_env_value "$key")"
    [[ "$value" == *@sha256:* ]] || {
      echo "ERROR: $key is not pinned by immutable digest. Run ./scripts/lock-images.sh --confirm." >&2
      exit 9
    }
  done
}

require_security_scan_pass() {
  local attestation="${project_dir}/reports/generated/security-scan-latest.txt"
  local key value
  [[ -f "$attestation" ]] || {
    echo "ERROR: No security scan attestation. Run ./scripts/security-scan.sh." >&2
    exit 9
  }
  grep -Fqx 'Result: PASS' "$attestation" || {
    echo "ERROR: The most recent security scan did not pass." >&2
    exit 9
  }
  for key in OLLAMA_IMAGE OPEN_WEBUI_IMAGE CADDY_IMAGE BACKUP_IMAGE; do
    value="$(load_env_value "$key")"
    grep -Fqx "${key}=${value}" "$attestation" || {
      echo "ERROR: Security scan evidence does not match current $key." >&2
      exit 9
    }
  done
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1"
  else
    sha256sum "$1"
  fi
}
