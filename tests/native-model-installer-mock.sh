#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-$project_dir}/nettap-native-installer.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT

mkdir -p "$test_dir/bin" "$test_dir/state"
cat >"$test_dir/bin/ollama" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  list)
    printf '%s\n' 'NAME ID SIZE MODIFIED'
    if [[ -f "${NETTAP_TEST_STATE_DIR}/pulled" ]]; then
      printf '%s\n' 'qwen2.5:7b-instruct-q4_K_M 845dbda0ea48 4.7 GB now'
    fi
    if [[ -f "${NETTAP_TEST_STATE_DIR}/created" ]]; then
      printf '%s\n' 'nettap-ai:0.3.0-rc.4 current 4.7 GB now'
    fi
    if [[ ! -f "${NETTAP_TEST_STATE_DIR}/legacy-removed" ]]; then
      printf '%s\n' 'nettap-ai:latest legacy 4.7 GB old'
      printf '%s\n' 'nettap-packet-expert:latest legacy2 4.7 GB old'
    fi
    printf '%s\n' 'qwen3:8b other 5.2 GB old'
    ;;
  pull)
    [[ "${2:-}" == "qwen2.5:7b-instruct-q4_K_M" ]]
    : >"${NETTAP_TEST_STATE_DIR}/pulled"
    ;;
  create)
    [[ "${2:-}" == "nettap-ai:0.3.0-rc.4" ]]
    [[ "${3:-}" == "-f" && -f "${4:-}" ]]
    : >"${NETTAP_TEST_STATE_DIR}/created"
    ;;
  show)
    [[ "${2:-}" == "--modelfile" ]]
    [[ "${3:-}" == "nettap-ai:0.3.0-rc.4" ]]
    [[ -f "${NETTAP_TEST_STATE_DIR}/created" ]]
    printf '%s\n' 'SYSTEM """You are the NetTAP Network Intelligence Model.'
    printf '%s\n' 'Network & Visibility mode'
    printf '%s\n' 'Packet Expert mode'
    # Exceed a 4 KiB pipe buffer. The former grep -q pipelines could close
    # early and make printf fail with SIGPIPE under set -o pipefail.
    awk 'BEGIN { for (i = 0; i < 20000; i++) print "combined-policy-filler" }'
    printf '%s\n' '"""'
    ;;
  rm)
    case "${2:-}" in
      nettap-ai:latest|nettap-packet-expert:latest) : > "${NETTAP_TEST_STATE_DIR}/legacy-removed" ;;
      *) printf 'unexpected model retirement: %s\n' "${2:-}" >&2; exit 99 ;;
    esac
    ;;
  *)
    printf 'unexpected mock ollama command: %s\n' "$*" >&2
    exit 99
    ;;
esac
MOCK
chmod +x "$test_dir/bin/ollama"

NETTAP_TEST_STATE_DIR="$test_dir/state" \
  PATH="$test_dir/bin:$PATH" \
  "$project_dir/scripts/install-model-native.sh" --confirm-download \
  >"$test_dir/output.txt"

grep -Fq 'PASS: nettap-ai:0.3.0-rc.4 is saved in the active Ollama store.' \
  "$test_dir/output.txt"
grep -Fq 'PASS: superseded native NetTAP model tags were retired.' "$test_dir/output.txt"
[[ -f "$test_dir/state/legacy-removed" ]]
echo "Native model installer regression test passed."
