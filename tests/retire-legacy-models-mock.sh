#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d "${project_dir}/.nettap-retire-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT

mkdir -p "$test_root/project/scripts" "$test_root/bin"
cp "$project_dir/scripts/common.sh" "$test_root/project/scripts/common.sh"
cp "$project_dir/scripts/retire-legacy-models.sh" "$test_root/project/scripts/retire-legacy-models.sh"

cat > "$test_root/project/.env" <<'EOF'
DEPLOYMENT_MODE=local
NETTAP_AI_MODEL=nettap-ai:0.3.0-rc.6
BASE_MODEL=qwen2.5:7b-instruct-q4_K_M
EOF
cat > "$test_root/project/.env.example" <<'EOF'
NETTAP_AI_MODEL=nettap-ai:0.3.0-rc.6
EOF

cat > "$test_root/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == "compose version" ]]; then
  echo "Docker Compose version v2.test"
elif [[ "$*" == *" ps -q ollama" ]]; then
  echo "ollama-container"
elif [[ "$*" == *" exec -T ollama ollama list" ]]; then
  echo 'NAME                                ID              SIZE'
  echo 'nettap-ai:0.3.0-rc.6                current         4.7 GB'
  if ! grep -Fqx 'container:nettap-ai:latest' "$NETTAP_RETIRE_TEST_LOG" 2>/dev/null; then
    echo 'nettap-ai:latest                    legacy-one      4.7 GB'
  fi
  if ! grep -Fqx 'container:nettap-ai-backup-20260730:latest' "$NETTAP_RETIRE_TEST_LOG" 2>/dev/null; then
    echo 'nettap-ai-backup-20260730:latest    legacy-two      4.7 GB'
  fi
  if ! grep -Fqx 'container:nettap-packet-expert:latest' "$NETTAP_RETIRE_TEST_LOG" 2>/dev/null; then
    echo 'nettap-packet-expert:latest         legacy-three    4.7 GB'
  fi
  echo 'qwen2.5:7b-instruct-q4_K_M          base            4.7 GB'
  echo 'kimi-k3:cloud                       other           -'
elif [[ "$*" == *" exec -T ollama ollama rm "* ]]; then
  printf 'container:%s\n' "${*: -1}" >> "$NETTAP_RETIRE_TEST_LOG"
else
  echo "Unexpected docker invocation: $*" >&2
  exit 1
fi
EOF
chmod +x "$test_root/bin/docker"

cat > "$test_root/bin/ollama" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  list)
    cat <<'MODELS'
NAME                          ID              SIZE
nettap-ai:latest              native-one      4.7 GB
nettap-packet-expert:latest   native-two      4.7 GB
qwen3:8b                      native-other    5.2 GB
MODELS
    ;;
  rm) printf 'native:%s\n' "$2" >> "$NETTAP_RETIRE_TEST_LOG" ;;
  *) echo "Unexpected native Ollama invocation: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$test_root/bin/ollama"

export NETTAP_RETIRE_TEST_LOG="$test_root/removed.log"
export PATH="$test_root/bin:$PATH"

dry_run="$("${test_root}/project/scripts/retire-legacy-models.sh" --include-native)"
[[ "$dry_run" == *"Dry run only"* ]]
[[ "$dry_run" == *"Legacy container tag: nettap-ai:latest"* ]]
[[ "$dry_run" == *"Legacy native tag: nettap-packet-expert:latest"* ]]
[[ ! -e "$NETTAP_RETIRE_TEST_LOG" ]]

printf '%s\n' 'NETTAP_AI_MODEL=nettap-ai:unexpected' > "$test_root/project/.env.example"
if "${test_root}/project/scripts/retire-legacy-models.sh" --confirm >/dev/null 2>&1; then
  echo "Retirement accepted an unapproved release model identity." >&2
  exit 1
fi
[[ ! -e "$NETTAP_RETIRE_TEST_LOG" ]]
printf '%s\n' 'NETTAP_AI_MODEL=nettap-ai:0.3.0-rc.6' > "$test_root/project/.env.example"

"${test_root}/project/scripts/retire-legacy-models.sh" --confirm --include-native >/dev/null

grep -Fqx 'container:nettap-ai:latest' "$NETTAP_RETIRE_TEST_LOG"
grep -Fqx 'container:nettap-ai-backup-20260730:latest' "$NETTAP_RETIRE_TEST_LOG"
grep -Fqx 'container:nettap-packet-expert:latest' "$NETTAP_RETIRE_TEST_LOG"
grep -Fqx 'native:nettap-ai:latest' "$NETTAP_RETIRE_TEST_LOG"
grep -Fqx 'native:nettap-packet-expert:latest' "$NETTAP_RETIRE_TEST_LOG"
if grep -Eq '0\.3\.0-rc\.4|qwen|kimi|qwen3' "$NETTAP_RETIRE_TEST_LOG"; then
  echo "Retirement attempted to remove a protected model." >&2
  exit 1
fi

echo "Legacy model retirement regression test passed."
