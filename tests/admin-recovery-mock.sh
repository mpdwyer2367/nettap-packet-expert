#!/usr/bin/env bash
set -euo pipefail

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporary_parent="${TMPDIR:-$source_root}"
test_root="$(mktemp -d "${temporary_parent}/nettap-admin-recovery.XXXXXX")"
cleanup() {
  case "$test_root" in
    */nettap-admin-recovery.*) rm -rf "$test_root" ;;
  esac
}
trap cleanup EXIT

mkdir -p "$test_root/scripts" "$test_root/bin"
cp "$source_root/scripts/common.sh" "$test_root/scripts/common.sh"
cp "$source_root/scripts/recover-admin.sh" "$test_root/scripts/recover-admin.sh"
cp "$source_root/scripts/recover_open_webui_admin.py" "$test_root/scripts/recover_open_webui_admin.py"
cp "$source_root/.env.example" "$test_root/.env"
chmod 0600 "$test_root/.env"

cat > "$test_root/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$NETTAP_RECOVERY_TEST_LOG"
if [[ "${1:-}" == info ]]; then
  exit 0
fi
if [[ "${1:-}" == compose && "$*" == *" ps -q open-webui"* ]]; then
  printf 'mock-open-webui\n'
  exit 0
fi
if [[ "${1:-}" == compose && "$*" == *" exec -T open-webui python"* ]]; then
  while IFS= read -r _line; do :; done
  exit 0
fi
if [[ "${1:-}" == cp ]]; then
  printf 'mock-sqlite-backup\n' > "$3"
  exit 0
fi
if [[ "${1:-}" == inspect ]]; then
  printf 'healthy\n'
  exit 0
fi
exit 0
MOCK
chmod +x "$test_root/bin/docker"

export NETTAP_RECOVERY_TEST_LOG="$test_root/docker.log"
export PATH="$test_root/bin:$PATH"
"$test_root/scripts/recover-admin.sh" --confirm >/dev/null

grep -Fqx 'WEBUI_ADMIN_EMAIL=admin@nettap.local' "$test_root/.env"
grep -Eq '^WEBUI_ADMIN_PASSWORD=Ntp!9[0-9a-f]{24}$' "$test_root/.env"
grep -Eq '^WEBUI_SECRET_KEY=[0-9a-f]{64}$' "$test_root/.env"
grep -Fqx 'Login: admin@nettap.local' "$test_root/.bootstrap-admin-password"
grep -Fqx 'Compose project: nettap-network-intelligence' "$test_root/.bootstrap-admin-password"
recovery_password="$(sed -n 's/^WEBUI_ADMIN_PASSWORD=//p' "$test_root/.env")"
if grep -Fq "$recovery_password" "$NETTAP_RECOVERY_TEST_LOG"; then
  echo 'ERROR: Recovery password appeared in Docker command arguments.' >&2
  exit 1
fi
test -s "$(find "$test_root/backups" -type f -name webui.db -print -quit)"
test -s "$(find "$test_root/backups" -type f -name SHA256SUMS -print -quit)"

echo 'Administrator recovery regression test passed.'
