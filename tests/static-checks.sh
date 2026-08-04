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
grep -q '^MODEL_NAME=nettap-packet-expert:0.1.0-rc.8$' "$project_dir/.env.example"
grep -q '^WEBUI_ADMIN_NAME=NetTAP Administrator$' "$project_dir/.env.example"
grep -q '^WEBUI_ADMIN_EMAIL=admin@nettap.local$' "$project_dir/.env.example"
grep -q '^WEBUI_ADMIN_PASSWORD=admin$' "$project_dir/.env.example"
grep -q 'WEBUI_ADMIN_EMAIL: ${WEBUI_ADMIN_EMAIL}' "$project_dir/compose.yaml"
grep -q 'WEBUI_ADMIN_PASSWORD: ${WEBUI_ADMIN_PASSWORD}' "$project_dir/compose.yaml"
grep -q 'ENABLE_SIGNUP: "False"' "$project_dir/compose.yaml"
grep -q 'ENABLE_PASSWORD_CHANGE_FORM: "True"' "$project_dir/compose.yaml"
grep -q 'nettap-bootstrap-password-rc8' "$project_dir/compose.yaml"
grep -q 'ENABLE_CODE_EXECUTION: "False"' "$project_dir/compose.yaml"
grep -q 'internal: true' "$project_dir/compose.yaml"
test -f "$project_dir/scripts/start-windows.ps1"
test -f "$project_dir/docs/AUTHENTICATION.md"
test -f "$project_dir/docs/WINDOWS_DEPLOYMENT.md"
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
    assert {"ollama", "model-init", "open-webui"} <= set(data["services"])
    env = data["services"]["open-webui"]["environment"]
    assert env["ENABLE_SIGNUP"] == "False"
    assert env["ENABLE_PASSWORD_CHANGE_FORM"] == "True"
    assert env["WEBUI_ADMIN_EMAIL"] == "${WEBUI_ADMIN_EMAIL}"
    assert env["WEBUI_ADMIN_PASSWORD"] == "${WEBUI_ADMIN_PASSWORD}"
print("Static checks passed.")
PY
