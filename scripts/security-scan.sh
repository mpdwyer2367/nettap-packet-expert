#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

require_runtime
initialize_env
require_digest_pins
docker scout version >/dev/null 2>&1 || {
  echo "ERROR: Docker Scout is required. Install or enable it in Docker Desktop/CLI." >&2
  exit 3
}

output_dir="${project_dir}/reports/generated/security-scan-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$output_dir"
status=0
scan_image() {
  local key="$1" image safe_name
  image="$(load_env_value "$key")"
  safe_name="$(printf '%s' "$key" | tr '[:upper:]' '[:lower:]')"
  docker scout sbom --format spdx --output "${output_dir}/${safe_name}.spdx.json" "$image"
  if ! docker scout cves --only-severity critical,high --exit-code "$image" \
    > "${output_dir}/${safe_name}-critical-high.txt" 2>&1; then
    status=1
  fi
}
for key in OLLAMA_IMAGE OPEN_WEBUI_IMAGE CADDY_IMAGE BACKUP_IMAGE; do
  scan_image "$key"
done
{
  printf 'Scan UTC: %s\n' "$(date -u +%FT%TZ)"
  printf 'Policy: no known HIGH or CRITICAL findings in deployed images\n'
  if [[ "$status" -eq 0 ]]; then printf 'Result: PASS\n'; else printf 'Result: FAIL\n'; fi
} > "${output_dir}/summary.txt"
{
  printf 'Scan UTC: %s\n' "$(date -u +%FT%TZ)"
  if [[ "$status" -eq 0 ]]; then printf 'Result: PASS\n'; else printf 'Result: FAIL\n'; fi
  for key in OLLAMA_IMAGE OPEN_WEBUI_IMAGE CADDY_IMAGE BACKUP_IMAGE; do
    printf '%s=%s\n' "$key" "$(load_env_value "$key")"
  done
  printf 'Evidence directory: %s\n' "$output_dir"
} > "${project_dir}/reports/generated/security-scan-latest.txt"
if [[ "$status" -ne 0 ]]; then
  echo "SECURITY GATE FAILED: review $output_dir" >&2
  exit 20
fi
echo "Security gate passed. Evidence: $output_dir"
