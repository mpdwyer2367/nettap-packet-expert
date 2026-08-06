#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/common.sh
source "${project_dir}/scripts/common.sh"

require_runtime
[[ -f "$env_file" ]] || { echo "ERROR: Deploy NetTAP Network Intelligence first." >&2; exit 3; }
nettap_model="$(load_env_value NETTAP_AI_MODEL)"
mode="$(load_env_value DEPLOYMENT_MODE)"
if [[ "$mode" == production ]]; then
  active_compose=("${compose_production[@]}")
else
  active_compose=("${compose_local[@]}")
fi

nettap_modelfile="$("${active_compose[@]}" exec -T ollama ollama show --modelfile "$nettap_model")"
nettap_from="$(printf '%s\n' "$nettap_modelfile" | awk '$1 == "FROM" {print $2; exit}')"
model_rows="$("${active_compose[@]}" exec -T ollama ollama list)"
legacy_models="$(printf '%s\n' "$model_rows" | awk -v current="$nettap_model" 'NR > 1 && $1 != current && ($1 ~ /^nettap-ai:/ || $1 ~ /^nettap-ai-backup-/ || $1 ~ /^nettap-packet-expert:/ || $1 ~ /^nettap-network-visibility:/) {print $1}')"

[[ -n "$nettap_from" ]] || {
  echo "FAIL: Unable to determine the shared Network Intelligence base reference." >&2
  exit 14
}
[[ -z "$legacy_models" ]] || {
  echo "FAIL: Superseded NetTAP model tags remain: $legacy_models" >&2
  exit 14
}

report="${project_dir}/reports/generated/model-storage-$(date -u +%Y%m%dT%H%M%SZ).txt"
mkdir -p "$(dirname "$report")"
{
  printf 'Result: PASS\n'
  printf 'Recorded UTC: %s\n' "$(date -u +%FT%TZ)"
  printf 'Combined model FROM reference: %s\n' "$nettap_from"
  printf 'NetTAP AI model: %s\n' "$nettap_model"
  printf 'Model store KiB: '
  "${active_compose[@]}" exec -T ollama sh -c "du -sk /root/.ollama/models | awk '{print \$1}'"
  printf 'Installed models:\n'
  printf '%s\n' "$model_rows"
} > "$report"

echo "PASS: the shared NetTAP Network Intelligence Model references one Ollama base blob."
echo "Measured report: $report"
echo "Boundary: the recorded store size is host evidence for this build; it is not a universal storage guarantee."
