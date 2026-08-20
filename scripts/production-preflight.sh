#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${script_dir}/common.sh"

require_runtime
initialize_env
docker info >/dev/null
cpu_count="$(docker info --format '{{.NCPU}}')"
memory_bytes="$(docker info --format '{{.MemTotal}}')"
available_kib="$(df -Pk "$project_dir" | awk 'NR==2 {print $4}')"
[[ "$cpu_count" -ge 8 ]] || { echo "FAIL: Docker requires at least 8 CPUs; detected $cpu_count." >&2; exit 11; }
[[ "$memory_bytes" -ge 17179869184 ]] || { echo "FAIL: Docker requires at least 16 GiB memory." >&2; exit 11; }
[[ "$available_kib" -ge 41943040 ]] || { echo "FAIL: At least 40 GiB free disk is required." >&2; exit 11; }
require_digest_pins
require_security_scan_pass
[[ -f "${project_dir}/config/tls/tls.crt" && -f "${project_dir}/config/tls/tls.key" ]] || {
  echo "FAIL: Production TLS is not configured." >&2; exit 11;
}
[[ "$(load_env_value WEBUI_ADMIN_PASSWORD)" != 'Password!' ]] || {
  echo "FAIL: Replace the documented local default administrator password before production." >&2; exit 11;
}
[[ -f "$admin_finalized_file" ]] || { echo "FAIL: Administrator activation is incomplete." >&2; exit 11; }
echo "Production preflight passed: CPU, memory, disk, digests, matching security scan, TLS, and administrator activation."
