#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/common.sh
source "${project_dir}/scripts/common.sh"

require_runtime
[[ -f "$env_file" ]] || { echo "ERROR: Deploy NetTAP AI Suite first." >&2; exit 3; }
visibility_model="$(load_env_value NETWORK_VISIBILITY_MODEL)"
packet_model="$(load_env_value PACKET_EXPERT_MODEL)"
mode="$(load_env_value DEPLOYMENT_MODE)"
if [[ "$mode" == production ]]; then
  active_compose=("${compose_production[@]}")
else
  active_compose=("${compose_local[@]}")
fi

visibility_modelfile="$("${active_compose[@]}" exec -T ollama ollama show --modelfile "$visibility_model")"
packet_modelfile="$("${active_compose[@]}" exec -T ollama ollama show --modelfile "$packet_model")"
visibility_from="$(printf '%s\n' "$visibility_modelfile" | awk '$1 == "FROM" {print $2; exit}')"
packet_from="$(printf '%s\n' "$packet_modelfile" | awk '$1 == "FROM" {print $2; exit}')"

[[ -n "$visibility_from" && -n "$packet_from" ]] || {
  echo "FAIL: Unable to determine assistant base references." >&2
  exit 14
}
[[ "$visibility_from" == "$packet_from" ]] || {
  echo "FAIL: Assistant manifests reference different model blobs." >&2
  echo "Network & Visibility FROM: $visibility_from" >&2
  echo "Packet Expert FROM: $packet_from" >&2
  exit 14
}

report="${project_dir}/reports/generated/model-storage-$(date -u +%Y%m%dT%H%M%SZ).txt"
mkdir -p "$(dirname "$report")"
{
  printf 'Result: PASS\n'
  printf 'Recorded UTC: %s\n' "$(date -u +%FT%TZ)"
  printf 'Shared FROM reference: %s\n' "$visibility_from"
  printf 'Network Visibility model: %s\n' "$visibility_model"
  printf 'Packet Expert model: %s\n' "$packet_model"
  printf 'Model store KiB: '
  "${active_compose[@]}" exec -T ollama sh -c "du -sk /root/.ollama/models | awk '{print \$1}'"
  printf 'Installed models:\n'
  "${active_compose[@]}" exec -T ollama ollama list
} > "$report"

echo "PASS: both assistant manifests reference the same Ollama base blob."
echo "Measured report: $report"
echo "Boundary: the recorded store size is host evidence for this build; it is not a universal storage guarantee."
