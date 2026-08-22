#!/usr/bin/env bash
set -euo pipefail

project_dir="${NETTAP_HOME:-/opt/nettap/current}"
env_file="${NETTAP_ENV_FILE:-/etc/nettap/nettap.env}"
state_dir="${NETTAP_STATE_DIR:-/var/lib/nettap/state}"
compose=(
  docker compose
  --project-directory "$project_dir"
  --env-file "$env_file"
  -f "${project_dir}/compose.yaml"
  -f "${project_dir}/compose.production.yaml"
  -f "${project_dir}/appliance/compose.appliance.yaml"
)

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "ERROR: This command must run as root." >&2
    exit 3
  fi
}

wait_for_service() {
  local service="$1" attempts="${2:-60}"
  local container_id="" status=""
  for _ in $(seq 1 "$attempts"); do
    container_id="$("${compose[@]}" ps -q "$service" 2>/dev/null || true)"
    if [[ -n "$container_id" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
      if [[ "$status" == healthy || "$status" == running ]]; then return 0; fi
    fi
    sleep 5
  done
  echo "ERROR: $service did not become healthy." >&2
  return 8
}

initialize_runtime() {
  local marker="${state_dir}/runtime-initialized"
  [[ -f "$marker" ]] && return 0
  install -d -m 0700 "$state_dir"

  "${compose[@]}" up -d ollama evidence-service
  wait_for_service ollama 90
  wait_for_service evidence-service 60

  # The Packer build preloads the image and model stores. These initialization
  # jobs therefore verify and materialize the pinned contract without needing
  # a registry connection on first boot.
  "${compose[@]}" --profile initialize run --rm --no-deps model-init
  "${compose[@]}" --profile initialize run --rm --no-deps rag-cache-init
  "${compose[@]}" up -d open-webui gateway
  wait_for_service open-webui 120
  wait_for_service gateway 60

  # Use the same supported Open WebUI API reconciler as the non-appliance
  # deployment, but include the appliance volume mapping.
  printf '%s\n' "$(sed -n 's/^WEBUI_ADMIN_PASSWORD=//p' "$env_file")" |
    "${compose[@]}" --profile provision run --rm -T assistant-provisioner

  {
    printf 'Initialized UTC: %s\n' "$(date -u +%FT%TZ)"
    printf 'Model: nettap-ai:0.4.0-rc.1\n'
    printf 'Compose project: nettap-packet-expert\n'
  } > "$marker"
  chmod 0600 "$marker"
}

case "${1:-}" in
  start)
    require_root
    initialize_runtime
    "${compose[@]}" up -d ollama evidence-service open-webui gateway
    ;;
  stop)
    require_root
    "${compose[@]}" down
    ;;
  restart)
    require_root
    "${compose[@]}" down
    initialize_runtime
    "${compose[@]}" up -d ollama evidence-service open-webui gateway
    ;;
  status)
    "${compose[@]}" ps
    ;;
  logs)
    shift
    "${compose[@]}" logs "$@"
    ;;
  compose)
    shift
    exec "${compose[@]}" "$@"
    ;;
  *)
    echo "Usage: runtime.sh {start|stop|restart|status|logs|compose}" >&2
    exit 2
    ;;
esac
