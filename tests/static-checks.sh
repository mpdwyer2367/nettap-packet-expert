#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

find "$project_dir" -type f -name '*.sh' -print | sort | while IFS= read -r script; do
  bash -n "$script"
done

grep -q '^FROM qwen2.5:7b-instruct-q4_K_M$' "$project_dir/model/Modelfile"
grep -q 'ollama pull qwen2.5:7b-instruct-q4_K_M' "$project_dir/compose.yaml"
grep -q 'Never claim that a capture' "$project_dir/model/Modelfile"
grep -q '^BIND_ADDRESS=127.0.0.1$' "$project_dir/.env.example"
grep -q 'ENABLE_CODE_EXECUTION: "False"' "$project_dir/compose.yaml"
grep -q 'internal: true' "$project_dir/compose.yaml"
grep -q 'workspace-init:' "$project_dir/compose.yaml"
grep -q 'skillIds' "$project_dir/workspace/install.py"
grep -q 'retrieval/query/collection' "$project_dir/workspace/install.py"
grep -q '^# NetTAP Packet Evidence Analysis$' "$project_dir/workspace/skills/nettap-packet-evidence-analysis.md"
grep -q 'Start-Windows.ps1' "$project_dir/README.md"
grep -q 'Windows-E2E.ps1' "$project_dir/docs/WINDOWS_DEPLOYMENT.md"
for required_file in \
  "$project_dir/scripts/Windows-Common.ps1" \
  "$project_dir/scripts/Start-Windows.ps1" \
  "$project_dir/scripts/Status-Windows.ps1" \
  "$project_dir/scripts/Stop-Windows.ps1" \
  "$project_dir/scripts/Update-Model-Windows.ps1" \
  "$project_dir/tests/Static-Checks.ps1" \
  "$project_dir/tests/Windows-E2E.ps1"; do
  [[ -f "$required_file" ]] || { echo "ERROR: Missing $required_file" >&2; exit 1; }
done
if grep -RIn --exclude=static-checks.sh 'mapfile' "$project_dir/scripts" "$project_dir/tests"; then
  echo "ERROR: mapfile is unavailable in the Bash 3.2 shipped with macOS." >&2
  exit 1
fi

if grep -RInE '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})' \
  --exclude-dir=.git "$project_dir"; then
  echo "ERROR: Possible private key or GitHub token found." >&2
  exit 1
fi

python3 - "$project_dir/compose.yaml" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
if "services:" not in text or "open-webui:" not in text or "ollama:" not in text:
    raise SystemExit("compose.yaml is missing required services")
try:
    import yaml
except ImportError:
    pass
else:
    data = yaml.safe_load(text)
    assert {"ollama", "model-init", "open-webui", "workspace-init"} <= set(data["services"])
print("Static checks passed.")
PY

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  temporary_env="$(mktemp)"
  cp "$project_dir/.env.example" "$temporary_env"
  docker compose --project-directory "$project_dir" --env-file "$temporary_env" -f "$project_dir/compose.yaml" config --quiet
  rm -f "$temporary_env"
fi
