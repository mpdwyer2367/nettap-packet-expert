#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/common.sh
source "${project_dir}/scripts/common.sh"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

require_runtime
[[ -f "$env_file" ]] || fail "Deploy NetTAP AI Suite before running rollback acceptance."
[[ "$(load_env_value DEPLOYMENT_MODE)" == local ]] || fail "Failed-update rollback test requires the loopback local profile."

environment_backup="$(mktemp "${TMPDIR:-/tmp}/nettap-env-rollback.XXXXXX")"
cp "$env_file" "$environment_backup"
restored=false
restore_environment() {
  if [[ "$restored" == false && -f "$environment_backup" ]]; then
    cp "$environment_backup" "$env_file"
    chmod 0600 "$env_file"
    restored=true
  fi
  rm -f "$environment_backup"
}
trap restore_environment EXIT

model="$(load_env_value NETTAP_AI_MODEL)"
before_rows="$("${compose_local[@]}" exec -T ollama ollama list)"
before_model_id="$(printf '%s\n' "$before_rows" | awk -v name="$model" '$1 == name {print $2}')"
before_fingerprint="$(installed_provisioning_fingerprint local)"
[[ -n "$before_model_id" && -n "$before_fingerprint" ]] || fail "Baseline model or provisioning identity is unavailable."

set_env_value EXPECTED_BASE_MODEL_ID "000000000000"
if (initialize_model_with_temporary_egress local); then
  fail "Deliberately invalid base identity did not stop the update."
fi
restore_environment
trap - EXIT

ready=false
for _ in $(seq 1 90); do
  if "${compose_local[@]}" exec -T ollama ollama show "$model" >/dev/null 2>&1 && \
    curl --fail --silent --show-error "http://127.0.0.1:$(load_env_value WEB_PORT)/health" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
[[ "$ready" == true ]] || fail "Prior runtime did not recover after the rejected update."

after_rows="$("${compose_local[@]}" exec -T ollama ollama list)"
after_model_id="$(printf '%s\n' "$after_rows" | awk -v name="$model" '$1 == name {print $2}')"
after_fingerprint="$(installed_provisioning_fingerprint local)"
[[ "$after_model_id" == "$before_model_id" ]] || fail "Combined model identity changed after rejected update."
[[ "$after_fingerprint" == "$before_fingerprint" ]] || fail "Provisioned assistant identity changed after rejected update."

ollama_id="$("${compose_local[@]}" ps -q ollama)"
if docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$ollama_id" | grep -q model-egress; then
  fail "Temporary registry egress remained attached after rollback."
fi

report="${project_dir}/reports/generated/failed-update-rollback-$(date -u +%Y%m%dT%H%M%SZ).txt"
mkdir -p "$(dirname "$report")"
{
  printf 'Result: PASS\n'
  printf 'Verified UTC: %s\n' "$(date -u +%FT%TZ)"
  printf 'Release: %s\n' "$(load_env_value RELEASE_VERSION)"
  printf 'Rejected condition: unexpected base-model identity\n'
  printf 'Retained NetTAP AI model ID: %s\n' "$after_model_id"
  printf 'Retained provisioning fingerprint: %s\n' "$after_fingerprint"
  printf 'Temporary model egress absent: PASS\n'
} > "$report"
echo "PASS: invalid model update was rejected and the prior offline runtime recovered unchanged."
echo "Boundary: this verifies failed-update recovery; cross-version rollback still requires the prior signed package and protected pre-upgrade backup."
echo "Report: $report"
