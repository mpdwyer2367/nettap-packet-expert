#!/usr/bin/env bash
set -euo pipefail

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporary_parent="${TMPDIR:-$source_root}"
test_root="$(mktemp -d "${temporary_parent}/nettap-local-repair.XXXXXX")"
cleanup() {
  case "$test_root" in
    */nettap-local-repair.*) rm -rf "$test_root" ;;
  esac
}
trap cleanup EXIT

mkdir -p "$test_root/scripts" "$test_root/bin"
cp "$source_root/scripts/common.sh" "$test_root/scripts/common.sh"
cp "$source_root/.env.example" "$test_root/.env"
: > "$test_root/compose.yaml"
: > "$test_root/compose.local.yaml"

cat > "$test_root/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$NETTAP_LOCAL_REPAIR_TEST_LOG"
if [[ "${1:-}" == compose && "$*" == *" ps -q open-webui"* ]]; then printf 'webui-id\n'; exit 0; fi
if [[ "${1:-}" == compose && "$*" == *" ps -q evidence-service"* ]]; then printf 'evidence-id\n'; exit 0; fi
if [[ "${1:-}" == compose && "$*" == *" ps -q assistant-launcher"* ]]; then printf 'launcher-id\n'; exit 0; fi
if [[ "${1:-}" == port && "${2:-}" == webui-id ]]; then printf '127.0.0.1:3100\n'; exit 0; fi
if [[ "${1:-}" == port && "${2:-}" == evidence-id ]]; then printf '127.0.0.1:3200\n'; exit 0; fi
if [[ "${1:-}" == port && "${2:-}" == launcher-id && "${3:-}" == 3000/tcp ]]; then printf '127.0.0.1:3000\n'; exit 0; fi
if [[ "${1:-}" == port && "${2:-}" == launcher-id && "${3:-}" == 3001/tcp ]]; then printf '127.0.0.1:3001\n'; exit 0; fi
exit 0
MOCK
chmod +x "$test_root/bin/docker"

cat > "$test_root/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$NETTAP_LOCAL_REPAIR_TEST_LOG"
exit 0
MOCK
chmod +x "$test_root/bin/curl"

export NETTAP_LOCAL_REPAIR_TEST_LOG="$test_root/runtime.log"
export PATH="$test_root/bin:$PATH"
# shellcheck source=scripts/common.sh
source "$test_root/scripts/common.sh"

recreate_local_interfaces >/dev/null
grep -Fq 'up -d --force-recreate open-webui evidence-service assistant-launcher' "$NETTAP_LOCAL_REPAIR_TEST_LOG"
grep -Fq 'port webui-id 8080/tcp' "$NETTAP_LOCAL_REPAIR_TEST_LOG"
grep -Fq 'port launcher-id 3000/tcp' "$NETTAP_LOCAL_REPAIR_TEST_LOG"
grep -Fq 'http://127.0.0.1:3100/health' "$NETTAP_LOCAL_REPAIR_TEST_LOG"
grep -Fq 'http://127.0.0.1:3001/system/health' "$NETTAP_LOCAL_REPAIR_TEST_LOG"

echo 'Local runtime recreation and port-verification regression test passed.'
