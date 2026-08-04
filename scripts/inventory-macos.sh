#!/usr/bin/env bash
set -euo pipefail

echo "NetTAP Packet Expert read-only deployment inventory"
echo "UTC: $(date -u +%FT%TZ)"
echo "Host: $(uname -a)"
echo "NOTE: This script does not stop, remove, or modify containers, volumes, models, or files."

echo
echo "[Docker client]"
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI: not found"
  exit 0
fi
docker version --format 'Client: {{.Client.Version}} | Server: {{if .Server}}{{.Server.Version}}{{else}}unavailable{{end}}' 2>&1 || true
docker compose version 2>&1 || true

echo
echo "[Compose projects]"
docker compose ls -a 2>&1 || true

echo
echo "[Containers: identity, image, state, ports, Compose provenance]"
container_ids="$(docker ps -aq 2>/dev/null || true)"
if [[ -z "$container_ids" ]]; then
  echo "No Docker containers found."
else
  for container_id in $container_ids; do
    docker inspect --format \
      'name={{.Name}} | image={{.Config.Image}} | state={{.State.Status}} | ports={{json .NetworkSettings.Ports}} | project={{index .Config.Labels "com.docker.compose.project"}} | service={{index .Config.Labels "com.docker.compose.service"}} | working_dir={{index .Config.Labels "com.docker.compose.project.working_dir"}} | config_files={{index .Config.Labels "com.docker.compose.project.config_files"}}' \
      "$container_id" 2>&1 || true
  done
fi

echo
echo "[Docker volumes: Compose ownership only]"
volume_names="$(docker volume ls -q 2>/dev/null || true)"
if [[ -z "$volume_names" ]]; then
  echo "No Docker volumes found."
else
  for volume_name in $volume_names; do
    docker volume inspect --format \
      'name={{.Name}} | project={{index .Labels "com.docker.compose.project"}} | volume={{index .Labels "com.docker.compose.volume"}}' \
      "$volume_name" 2>&1 || true
  done
fi

echo
echo "[Listening application ports]"
if command -v lsof >/dev/null 2>&1; then
  for port in 3000 3001 11434; do
    echo "Port $port"
    lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || echo "not listening"
  done
else
  echo "lsof: not found"
fi

echo
echo "[Native Ollama]"
if command -v ollama >/dev/null 2>&1; then
  ollama --version 2>&1 || true
  ollama list 2>&1 || true
else
  echo "Native Ollama CLI: not found"
fi

echo
echo "[Containerized Ollama models]"
ollama_ids="$(docker ps -q --filter 'ancestor=ollama/ollama' 2>/dev/null || true)"
if [[ -z "$ollama_ids" ]]; then
  echo "No running ollama/ollama containers found."
else
  for container_id in $ollama_ids; do
    container_name="$(docker inspect --format '{{.Name}}' "$container_id" | sed 's#^/##')"
    echo "Container: $container_name"
    docker exec "$container_id" ollama list 2>&1 || true
  done
fi

echo
echo "[Likely NetTAP Git working copies]"
find "$HOME" -maxdepth 4 -type d -name .git -print 2>/dev/null | while IFS= read -r git_dir; do
  repository_dir="${git_dir%/.git}"
  case "$(basename "$repository_dir")" in
    *nettap*|*NetTAP*|*packet-expert*|*Packet-Expert*)
      remote="$(git -C "$repository_dir" remote get-url origin 2>/dev/null || echo unavailable)"
      remote="$(printf '%s' "$remote" | sed -E 's#(https?://)[^/@]+:[^/@]+@#\1REDACTED@#')"
      branch="$(git -C "$repository_dir" branch --show-current 2>/dev/null || echo unavailable)"
      commit="$(git -C "$repository_dir" rev-parse HEAD 2>/dev/null || echo unavailable)"
      printf 'path=%s | branch=%s | commit=%s | origin=%s\n' "$repository_dir" "$branch" "$commit" "$remote"
      ;;
  esac
done

echo
echo "Inventory complete. Review this output before stopping any deployment."
