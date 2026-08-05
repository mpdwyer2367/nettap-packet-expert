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
test -f "$project_dir/LICENSE"
test -f "$project_dir/NOTICE"
grep -q '^Apache License
test -f "$project_dir/scripts/inventory-macos.sh"
test -f "$project_dir/scripts/verify-macos-deployment.sh"
test -f "$project_dir/tests/model-behavior-eval.sh"
test -f "$project_dir/tests/colleague-macos-acceptance.sh"
test -f "$project_dir/docs/AUTHENTICATION.md"
test -f "$project_dir/docs/WINDOWS_DEPLOYMENT.md"
test -f "$project_dir/docs/COMPLETE_OPERATIONS_MANUAL.md"
test -f "$project_dir/docs/VALIDATION_STATUS.md"
test -f "$project_dir/docs/COLLEAGUE_EVALUATION_GUIDE.md"
test -f "$project_dir/reports/PUBLIC_COLLEAGUE_READINESS_2026-08-04.md"
grep -q 'com.docker.compose.project.working_dir' "$project_dir/scripts/verify-macos-deployment.sh"
grep -Fq 'ollama/ollama:*)' "$project_dir/scripts/inventory-macos.sh"
if grep -RIn --exclude=static-checks.sh 'mapfile' "$project_dir/scripts" "$project_dir/tests"; then
  echo "ERROR: mapfile is unavailable in the Bash 3.2 shipped with macOS." >&2
  exit 1
fi

if grep -RInE '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})' \
  --exclude-dir=.git "$project_dir"; then
  echo "ERROR: Possible private key or GitHub token found." >&2
  exit 1
fi

if grep -InE 'no license (has|has yet) been selected|must select and add a license' \
  "$project_dir/README.md" \
  "$project_dir/THIRD_PARTY_NOTICES.md" \
  "$project_dir/docs/COLLEAGUE_EVALUATION_GUIDE.md" \
  "$project_dir/reports/PUBLIC_COLLEAGUE_READINESS_2026-08-04.md"; then
  echo "ERROR: Stale project-license warning found." >&2
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

python3 - "$project_dir" <<'PY'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
missing = []
pattern = re.compile(r'\[[^]]+\]\(([^)]+)\)')
for document in root.rglob('*.md'):
    for target in pattern.findall(document.read_text(encoding='utf-8')):
        if target.startswith(('http://', 'https://', '#', 'mailto:')):
            continue
        path = target.split('#', 1)[0]
        if path and not (document.parent / path).resolve().exists():
            missing.append(f'{document.relative_to(root)} -> {target}')
if missing:
    raise SystemExit('Missing relative documentation targets:\n' + '\n'.join(missing))
print('Documentation links passed.')
PY
 "$project_dir/LICENSE"
grep -q '^Version 2.0, January 2004
test -f "$project_dir/scripts/inventory-macos.sh"
test -f "$project_dir/scripts/verify-macos-deployment.sh"
test -f "$project_dir/tests/model-behavior-eval.sh"
test -f "$project_dir/tests/colleague-macos-acceptance.sh"
test -f "$project_dir/docs/AUTHENTICATION.md"
test -f "$project_dir/docs/WINDOWS_DEPLOYMENT.md"
test -f "$project_dir/docs/COMPLETE_OPERATIONS_MANUAL.md"
test -f "$project_dir/docs/VALIDATION_STATUS.md"
test -f "$project_dir/docs/COLLEAGUE_EVALUATION_GUIDE.md"
test -f "$project_dir/reports/PUBLIC_COLLEAGUE_READINESS_2026-08-04.md"
grep -q 'com.docker.compose.project.working_dir' "$project_dir/scripts/verify-macos-deployment.sh"
grep -Fq 'ollama/ollama:*)' "$project_dir/scripts/inventory-macos.sh"
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

python3 - "$project_dir" <<'PY'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
missing = []
pattern = re.compile(r'\[[^]]+\]\(([^)]+)\)')
for document in root.rglob('*.md'):
    for target in pattern.findall(document.read_text(encoding='utf-8')):
        if target.startswith(('http://', 'https://', '#', 'mailto:')):
            continue
        path = target.split('#', 1)[0]
        if path and not (document.parent / path).resolve().exists():
            missing.append(f'{document.relative_to(root)} -> {target}')
if missing:
    raise SystemExit('Missing relative documentation targets:\n' + '\n'.join(missing))
print('Documentation links passed.')
PY
 "$project_dir/LICENSE"
grep -q '^Copyright 2026 NetTAP Technology Limited
test -f "$project_dir/scripts/inventory-macos.sh"
test -f "$project_dir/scripts/verify-macos-deployment.sh"
test -f "$project_dir/tests/model-behavior-eval.sh"
test -f "$project_dir/tests/colleague-macos-acceptance.sh"
test -f "$project_dir/docs/AUTHENTICATION.md"
test -f "$project_dir/docs/WINDOWS_DEPLOYMENT.md"
test -f "$project_dir/docs/COMPLETE_OPERATIONS_MANUAL.md"
test -f "$project_dir/docs/VALIDATION_STATUS.md"
test -f "$project_dir/docs/COLLEAGUE_EVALUATION_GUIDE.md"
test -f "$project_dir/reports/PUBLIC_COLLEAGUE_READINESS_2026-08-04.md"
grep -q 'com.docker.compose.project.working_dir' "$project_dir/scripts/verify-macos-deployment.sh"
grep -Fq 'ollama/ollama:*)' "$project_dir/scripts/inventory-macos.sh"
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

python3 - "$project_dir" <<'PY'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
missing = []
pattern = re.compile(r'\[[^]]+\]\(([^)]+)\)')
for document in root.rglob('*.md'):
    for target in pattern.findall(document.read_text(encoding='utf-8')):
        if target.startswith(('http://', 'https://', '#', 'mailto:')):
            continue
        path = target.split('#', 1)[0]
        if path and not (document.parent / path).resolve().exists():
            missing.append(f'{document.relative_to(root)} -> {target}')
if missing:
    raise SystemExit('Missing relative documentation targets:\n' + '\n'.join(missing))
print('Documentation links passed.')
PY
 "$project_dir/NOTICE"
test -f "$project_dir/scripts/start-windows.ps1"
test -f "$project_dir/scripts/inventory-macos.sh"
test -f "$project_dir/scripts/verify-macos-deployment.sh"
test -f "$project_dir/tests/model-behavior-eval.sh"
test -f "$project_dir/tests/colleague-macos-acceptance.sh"
test -f "$project_dir/docs/AUTHENTICATION.md"
test -f "$project_dir/docs/WINDOWS_DEPLOYMENT.md"
test -f "$project_dir/docs/COMPLETE_OPERATIONS_MANUAL.md"
test -f "$project_dir/docs/VALIDATION_STATUS.md"
test -f "$project_dir/docs/COLLEAGUE_EVALUATION_GUIDE.md"
test -f "$project_dir/reports/PUBLIC_COLLEAGUE_READINESS_2026-08-04.md"
grep -q 'com.docker.compose.project.working_dir' "$project_dir/scripts/verify-macos-deployment.sh"
grep -Fq 'ollama/ollama:*)' "$project_dir/scripts/inventory-macos.sh"
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

python3 - "$project_dir" <<'PY'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
missing = []
pattern = re.compile(r'\[[^]]+\]\(([^)]+)\)')
for document in root.rglob('*.md'):
    for target in pattern.findall(document.read_text(encoding='utf-8')):
        if target.startswith(('http://', 'https://', '#', 'mailto:')):
            continue
        path = target.split('#', 1)[0]
        if path and not (document.parent / path).resolve().exists():
            missing.append(f'{document.relative_to(root)} -> {target}')
if missing:
    raise SystemExit('Missing relative documentation targets:\n' + '\n'.join(missing))
print('Documentation links passed.')
PY
