#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

confirm=false
include_native=false

usage() {
  cat <<'EOF'
Usage: ./scripts/retire-legacy-models.sh [--confirm] [--include-native]

Without --confirm, prints the legacy NetTAP model tags that would be removed.
--include-native also retires NetTAP tags from the host's native Ollama store
after the current containerized NetTAP Network Intelligence Model is verified.

The current model, base model, non-NetTAP models, Open WebUI data, knowledge,
chats, and Docker volumes are never removed by this command.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm) confirm=true ;;
    --include-native) include_native=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

is_nettap_tag() {
  case "$1" in
    nettap-ai:*|nettap-ai-backup-*|nettap-packet-expert:*|nettap-network-visibility:*) return 0 ;;
    *) return 1 ;;
  esac
}

is_preserved_candidate() {
  local model="$1" manifest
  for manifest in "${project_dir}"/model/candidates/*.json; do
    [[ -f "$manifest" ]] || continue
    if python3 - "$manifest" "$model" <<'PY'
import json
import sys
from pathlib import Path

candidate = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
raise SystemExit(
    0
    if candidate.get("status") == "evaluation-only" and candidate.get("runtime_model") == sys.argv[2]
    else 1
)
PY
    then
      return 0
    fi
  done
  return 1
}

model_names() {
  awk 'NR > 1 {gsub(/\r/, "", $1); if ($1 != "") print $1}'
}

require_runtime
[[ -f "$env_file" ]] || {
  echo "ERROR: NetTAP Network Intelligence is not initialized; .env is missing." >&2
  exit 3
}

mode="$(load_env_value DEPLOYMENT_MODE)"
selected=("${compose_local[@]}")
if [[ "$mode" == production ]]; then selected=("${compose_production[@]}"); fi

ollama_container="$("${selected[@]}" ps -q ollama)"
[[ -n "$ollama_container" ]] || {
  echo "ERROR: The canonical containerized Ollama service is not running." >&2
  exit 4
}

current_model="$(load_env_value NETTAP_AI_MODEL)"
base_model="$(load_env_value BASE_MODEL)"
approved_model="$(sed -n 's/^NETTAP_AI_MODEL=//p' "${project_dir}/.env.example" | tail -n 1)"
[[ -n "$approved_model" && "$current_model" == "$approved_model" ]] || {
  echo "ERROR: .env selects $current_model but this release approves $approved_model; no tags were changed." >&2
  exit 5
}
container_rows="$("${selected[@]}" exec -T ollama ollama list)"
printf '%s\n' "$container_rows" | awk -v model="$current_model" 'NR > 1 && $1 == model {found=1} END {exit !found}' || {
  echo "ERROR: Current NetTAP Network Intelligence Model is not installed: $current_model" >&2
  exit 5
}

container_candidates=()
preserved_candidates=()
while IFS= read -r model; do
  if [[ "$model" != "$current_model" ]] && is_nettap_tag "$model"; then
    if is_preserved_candidate "$model"; then
      preserved_candidates+=("$model")
    else
      container_candidates+=("$model")
    fi
  fi
done <<< "$(printf '%s\n' "$container_rows" | model_names)"

native_candidates=()
if [[ "$include_native" == true ]]; then
  require_command ollama
  native_rows="$(env -u OLLAMA_HOST ollama list)" || {
    echo "ERROR: Native Ollama is unavailable; no native tags were changed." >&2
    exit 6
  }
  while IFS= read -r model; do
    if is_nettap_tag "$model"; then native_candidates+=("$model"); fi
  done <<< "$(printf '%s\n' "$native_rows" | model_names)"
fi

echo "NetTAP Network Intelligence model lifecycle"
echo "Current container model: $current_model"
echo "Shared base model retained: $base_model"
if [[ ${#container_candidates[@]} -eq 0 ]]; then
  echo "Legacy container tags: none"
else
  printf 'Legacy container tag: %s\n' "${container_candidates[@]}"
fi
if [[ ${#preserved_candidates[@]} -gt 0 ]]; then
  printf 'Preserved evaluation candidate: %s\n' "${preserved_candidates[@]}"
fi
if [[ "$include_native" == true ]]; then
  if [[ ${#native_candidates[@]} -eq 0 ]]; then
    echo "Legacy native tags: none"
  else
    printf 'Legacy native tag: %s\n' "${native_candidates[@]}"
  fi
fi

if [[ "$confirm" != true ]]; then
  echo "Dry run only. Rerun with --confirm after backup and acceptance."
  exit 0
fi

for model in "${container_candidates[@]}"; do
  "${selected[@]}" exec -T ollama ollama rm "$model"
done

if [[ "$include_native" == true ]]; then
  for model in "${native_candidates[@]}"; do
    env -u OLLAMA_HOST ollama rm "$model"
  done
fi

remaining_rows="$("${selected[@]}" exec -T ollama ollama list)"
printf '%s\n' "$remaining_rows" | awk -v model="$current_model" 'NR > 1 && $1 == model {found=1} END {exit !found}' || {
  echo "ERROR: Current model disappeared during retirement; stop and investigate." >&2
  exit 7
}
while IFS= read -r model; do
  if [[ "$model" != "$current_model" ]] && is_nettap_tag "$model" && ! is_preserved_candidate "$model"; then
    echo "ERROR: Legacy container tag remains: $model" >&2
    exit 7
  fi
done <<< "$(printf '%s\n' "$remaining_rows" | model_names)"

echo "PASS: $current_model is the only selected NetTAP release tag; declared evaluation candidates may coexist."
echo "The two Open WebUI experiences remain lightweight profiles over this one model."
echo "No Docker volume, Open WebUI account, chat, knowledge collection, or non-NetTAP model was removed."
