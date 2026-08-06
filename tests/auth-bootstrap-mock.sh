#!/usr/bin/env bash
set -euo pipefail

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporary_parent="${TMPDIR:-$source_root}"
test_root="$(mktemp -d "${temporary_parent}/nettap-auth-bootstrap.XXXXXX")"
cleanup() {
  case "$test_root" in
    */nettap-auth-bootstrap.*) rm -rf "$test_root" ;;
  esac
}
trap cleanup EXIT

mkdir -p "$test_root/scripts" "$test_root/bin"
cp "$source_root/scripts/common.sh" "$test_root/scripts/common.sh"
cp "$source_root/.env.example" "$test_root/.env.example"

cat > "$test_root/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == ps && "${2:-}" == -aq ]]; then
  printf 'legacy-container-id\n'
  exit 0
fi
if [[ "${1:-}" == volume && "${2:-}" == inspect ]]; then
  printf 'volume-inspect:%s\n' "${3:-}" >> "$NETTAP_AUTH_TEST_LOG"
  exit 1
fi
if [[ "${1:-}" == compose ]]; then
  printf 'compose:%s\n' "$*" >> "$NETTAP_AUTH_TEST_LOG"
  exit 0
fi
exit 0
MOCK
chmod +x "$test_root/bin/docker"

export NETTAP_AUTH_TEST_LOG="$test_root/docker.log"
export PATH="$test_root/bin:$PATH"
# shellcheck source=scripts/common.sh
source "$test_root/scripts/common.sh"

initialize_env
stop_legacy_runtime_preserving_data
prepare_canonical_admin_bootstrap
grep -Fqx 'WEBUI_ADMIN_EMAIL=admin@nettap.local' "$env_file"
grep -Fqx 'Login: admin@nettap.local' "$bootstrap_password_file"
grep -Fqx 'Compose project: nettap-network-intelligence' "$bootstrap_password_file"
grep -Fq 'compose:compose --project-name nettap-packet-expert' "$NETTAP_AUTH_TEST_LOG"
grep -Fqx 'volume-inspect:nettap-network-intelligence_packet-expert-open-webui-data' "$NETTAP_AUTH_TEST_LOG"

rm -f "$env_file" "$bootstrap_password_file" "$admin_finalized_file"
: > "$NETTAP_AUTH_TEST_LOG"
export COMPOSE_PROJECT_NAME="nettap-acceptance-auth-test"
initialize_env
stop_legacy_runtime_preserving_data
prepare_canonical_admin_bootstrap
grep -Fqx 'Compose project: nettap-acceptance-auth-test' "$bootstrap_password_file"
grep -Fqx 'volume-inspect:nettap-acceptance-auth-test_packet-expert-open-webui-data' "$NETTAP_AUTH_TEST_LOG"
if grep -Fq 'compose:' "$NETTAP_AUTH_TEST_LOG"; then
  echo 'ERROR: Isolated acceptance project attempted to stop the legacy runtime.' >&2
  exit 1
fi

echo 'Authentication bootstrap and Compose isolation regression test passed.'
