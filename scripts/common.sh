#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${project_dir}/.env"
bootstrap_password_file="${project_dir}/.bootstrap-admin-password"
admin_finalized_file="${project_dir}/.admin-bootstrap-finalized"

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
  ensure_env_default RELEASE_VERSION "0.2.0-rc.1"
  ensure_env_default OLLAMA_IMAGE "ollama/ollama:0.32.5"
  ensure_env_default OPEN_WEBUI_IMAGE "ghcr.io/open-webui/open-webui:v0.11.0"
  ensure_env_default CADDY_IMAGE "caddy:2.11.4-alpine"
  ensure_env_default BACKUP_IMAGE "alpine:3.24.1"
  ensure_env_default MODEL_NAME "nettap-packet-expert:0.2.0-rc.1"
  ensure_env_default EXPECTED_BASE_MODEL_ID "845dbda0ea48"
  ensure_env_default DEPLOYMENT_MODE "local"
  ensure_env_default BIND_ADDRESS "127.0.0.1"
  ensure_env_default WEB_PORT "3001"
  ensure_env_default HTTPS_BIND_ADDRESS "0.0.0.0"
  ensure_env_default HTTPS_PORT "8443"
  ensure_env_default APPLIANCE_HOSTNAME "packet-expert.local"
  ensure_env_default WEBUI_SECRET_KEY "GENERATE_ON_FIRST_START"
  ensure_env_default JWT_EXPIRES_IN "8h"
  ensure_env_default OLLAMA_CPUS "6"
  ensure_env_default OLLAMA_MEMORY "8g"
  ensure_env_default WEBUI_CPUS "2"
  ensure_env_default WEBUI_MEMORY "3g"
  ensure_env_default GATEWAY_CPUS "1"
  ensure_env_default GATEWAY_MEMORY "512m"
  if grep -q '^MODEL_NAME=nettap-packet-expert:0.1.0-rc.8$' "$env_file"; then
    set_env_value MODEL_NAME "nettap-packet-expert:0.2.0-rc.1"
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
compose=("${compose_local[@]}")

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
      "${compose_production[@]}" up -d ollama open-webui gateway || true
    fi
  else
    "${compose_local_bootstrap[@]}" down >/dev/null 2>&1 || true
    if [[ "$was_running" == true ]]; then
      "${compose_local[@]}" up -d ollama open-webui || true
    fi
  fi
  echo "ERROR: Model initialization failed. Temporary registry egress was removed; any prior runtime restart was attempted." >&2
  exit 9
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
      "${compose_local_bootstrap[@]}" down || recover_failed_model_initialization local "$was_running"
      "${compose_local[@]}" up -d ollama open-webui
      record_model_identity local
      ;;
    production)
      if [[ -n "$("${compose_production[@]}" ps -q open-webui 2>/dev/null)" ]]; then was_running=true; fi
      "${compose_production[@]}" down >/dev/null 2>&1 || true
      "${compose_production_bootstrap[@]}" config >/dev/null || recover_failed_model_initialization production "$was_running"
      "${compose_production_bootstrap[@]}" pull || recover_failed_model_initialization production "$was_running"
      "${compose_production_bootstrap[@]}" up -d ollama || recover_failed_model_initialization production "$was_running"
      wait_for_ollama_production_bootstrap || recover_failed_model_initialization production "$was_running"
      "${compose_production_bootstrap[@]}" --profile initialize run --rm model-init || recover_failed_model_initialization production "$was_running"
      "${compose_production_bootstrap[@]}" down || recover_failed_model_initialization production "$was_running"
      "${compose_production[@]}" up -d ollama open-webui
      record_model_identity production
      ;;
    *)
      echo "ERROR: Unknown deployment mode: $runtime_name" >&2
      exit 2
      ;;
  esac
  echo "Model initialization complete; registry egress was removed from the ${runtime_name} runtime."
}

record_model_identity() {
  local mode="$1" rows base_id custom_id expected_id custom_name
  expected_id="$(load_env_value EXPECTED_BASE_MODEL_ID)"
  custom_name="$(load_env_value MODEL_NAME)"
  if [[ "$mode" == production ]]; then
    rows="$("${compose_production[@]}" exec -T ollama ollama list)"
  else
    rows="$("${compose_local[@]}" exec -T ollama ollama list)"
  fi
  base_id="$(printf '%s\n' "$rows" | awk '$1 == "qwen2.5:7b-instruct-q4_K_M" {print $2}')"
  custom_id="$(printf '%s\n' "$rows" | awk -v name="$custom_name" '$1 == name {print $2}')"
  [[ "$base_id" == "$expected_id" ]] || {
    echo "ERROR: Base-model identity is $base_id; expected $expected_id. Release review is required." >&2
    exit 9
  }
  [[ -n "$custom_id" ]] || { echo "ERROR: Custom model identity is unavailable." >&2; exit 9; }
  mkdir -p "${project_dir}/reports/generated"
  {
    printf 'Recorded UTC: %s\n' "$(date -u +%FT%TZ)"
    printf 'Base model: qwen2.5:7b-instruct-q4_K_M\n'
    printf 'Base model ID: %s\n' "$base_id"
    printf 'Custom model: %s\n' "$custom_name"
    printf 'Custom model ID: %s\n' "$custom_id"
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
