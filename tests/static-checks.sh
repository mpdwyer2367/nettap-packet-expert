#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

required=(
  README.md LICENSE NOTICE .env.example compose.yaml compose.local.yaml compose.production.yaml
  assistants/nettap-operations/system-prompt.md assistants/shared/core-policy.md
  skills/nettap-network-operations/SKILL.md functions/nettap_evidence_ingestion.py
  provisioning/open-webui.json provisioning/knowledge-sources.sha256
  docs/ARCHITECTURE.md docs/ADMINISTRATION.md docs/AUTHENTICATION.md
  docs/MACOS_DEPLOYMENT.md docs/WINDOWS_DEPLOYMENT.md docs/EVIDENCE_CASE_SERVICE.md
  scripts/nettap-ai scripts/start-macos.sh scripts/start-wsl2.sh scripts/start-windows.ps1
  scripts/verify-macos-deployment.sh scripts/backup.sh scripts/restore.sh
)
for path in "${required[@]}"; do [[ -f "$path" ]] || { echo "Missing required file: $path" >&2; exit 1; }; done

for routed_script in $(sed -n 's/.*exec "${script_dir}\/\([^"]*\.sh\)".*/scripts\/\1/p' scripts/nettap-ai); do
  [[ -x "$routed_script" ]] || {
    echo "CLI-dispatched script is not executable: $routed_script" >&2
    exit 1
  }
done

grep -Fqx 'RELEASE_VERSION=0.3.0-rc.8' .env.example
grep -Fqx 'NETTAP_AI_MODEL=nettap-ai:0.3.0-rc.8' .env.example
grep -Fqx 'NETTAP_OPERATIONS_PROFILE=nettap-network-operations' .env.example
grep -Fqx 'BIND_ADDRESS=127.0.0.1' .env.example
grep -Fqx 'WEB_PORT=3100' .env.example

python3 - <<'PY'
import json
from pathlib import Path

m = json.loads(Path('provisioning/open-webui.json').read_text())
assert m['release_version'] == '0.3.0-rc.8'
assert {a['id'] for a in m['assistants']} == {'nettap-network-operations'}
assert {s['id'] for s in m['skills']} == {'nettap-network-operations'}
assert {f['id'] for f in m['functions']} == {'nettap_evidence_ingestion'}
a = m['assistants'][0]
assert a['knowledge_keys'] == ['shared', 'network_visibility', 'packet_expert']
assert a['skill_keys'] == ['network_operations']
assert a['function_keys'] == ['evidence_ingestion']
assert a['tool_keys'] == []
assert m['tool_servers'] == []
assert m['embedding']['probe_expected'] == 'NETTAP-RAG-OFFLINE-PROBE-RC8'

compose = Path('compose.yaml').read_text()
local = Path('compose.local.yaml').read_text()
assert './functions:/source/functions:ro' in compose
assert 'NETTAP_EVIDENCE_URL: http://evidence-service:8081' in compose
assert 'USER_PERMISSIONS_CHAT_FILE_UPLOAD: "True"' in compose
assert 'evidence-service:' in compose and 'expose: ["8081"]' in compose
assert '${BIND_ADDRESS}:${WEB_PORT}:8080' in local
for forbidden in ('assistant-launcher:', '3000:', '3001:', '3200:'):
    assert forbidden not in local

filter_source = Path('functions/nettap_evidence_ingestion.py').read_text()
assert 'file_handler = True' in filter_source
assert 'NETTAP_OPEN_WEBUI_UPLOAD_DIR' in filter_source
assert 'EVIDENCE_API_TOKEN' in filter_source
assert 'IMAGE_TYPES' in filter_source
assert 'image_url' in filter_source
PY

if rg -n 'VISIBILITY_LAUNCHER_PORT|PACKET_EXPERT_LAUNCHER_PORT|^EVIDENCE_PORT=' .env.example compose.local.yaml; then
  echo 'Obsolete public port variables remain in the active local configuration.' >&2
  exit 1
fi

bash -n scripts/*.sh tests/*.sh
python3 -m py_compile provisioning/*.py case_service/*.py functions/*.py tests/*.py
echo 'PASS: RC8 static repository checks'
