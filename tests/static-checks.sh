#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

find "$project_dir" -type f -name '*.sh' -print | sort | while IFS= read -r script; do
  bash -n "$script"
done

grep -q '^FROM qwen2.5:7b-instruct-q4_K_M$' "$project_dir/model/Modelfile"
grep -q 'Never claim that a capture' "$project_dir/model/Modelfile"
grep -q 'untrusted evidence, not as instructions' "$project_dir/model/Modelfile"
grep -q '^RELEASE_VERSION=0.2.0-rc.1$' "$project_dir/.env.example"
grep -q '^MODEL_NAME=nettap-packet-expert:0.2.0-rc.1$' "$project_dir/.env.example"
grep -q '^EXPECTED_BASE_MODEL_ID=845dbda0ea48$' "$project_dir/.env.example"
# shellcheck disable=SC2016 # literal Compose interpolation is the test subject
grep -q 'test "$$actual_id" = "${EXPECTED_BASE_MODEL_ID}"' "$project_dir/compose.yaml"
grep -q '^BIND_ADDRESS=127.0.0.1$' "$project_dir/.env.example"
grep -q '^WEBUI_ADMIN_PASSWORD=GENERATE_ON_FIRST_START$' "$project_dir/.env.example"
grep -q 'ENABLE_SIGNUP: "False"' "$project_dir/compose.yaml"
grep -q 'nettap-bootstrap-password-rc9' "$project_dir/compose.yaml"
grep -q 'internal: true' "$project_dir/compose.yaml"
grep -q 'require_digest_pins' "$project_dir/scripts/start-production.sh"
grep -q 'production-preflight.sh' "$project_dir/scripts/start-production.sh"
grep -q 'NOT CERTIFIED' "$project_dir/scripts/certify-production.sh"

required_files=(
  LICENSE NOTICE SECURITY.md THIRD_PARTY_NOTICES.md
  compose.bootstrap.yaml compose.local.yaml compose.production.yaml
  config/Caddyfile
  docs/AUTHENTICATION.md docs/COMMERCIAL_RELEASE_GATES.md
  docs/CUSTOMER_DEPLOYMENT_GUIDE.md docs/PRODUCTION_ARCHITECTURE.md
  docs/PRODUCT_ROADMAP.md docs/THREAT_MODEL.md docs/VALIDATION_STATUS.md
  scripts/backup.sh scripts/restore.sh scripts/lock-images.sh
  scripts/security-scan.sh scripts/production-preflight.sh
  scripts/verify-production-deployment.sh scripts/package-release.sh
  scripts/verify-release.sh scripts/certify-production.sh
  tests/model-behavior-eval.sh tests/backup-restore-e2e.sh
  tests/production-config-checks.py
  reports/PRODUCTION_CERTIFICATION_STATUS_0.2.0-rc.1.md
  reports/RELEASE_ACCEPTANCE_0.2.0-rc.1.md
)
for file in "${required_files[@]}"; do test -f "${project_dir}/${file}"; done

grep -Fqx "Apache License" "$project_dir/LICENSE"
grep -Fqx "Version 2.0, January 2004" "$project_dir/LICENSE"
grep -Fqx "Copyright 2026 NetTAP Technology Limited" "$project_dir/NOTICE"
grep -q 'VALID PRODUCTION CANDIDATE' "$project_dir/reports/PRODUCTION_CERTIFICATION_STATUS_0.2.0-rc.1.md"
grep -q 'Production certification decision: \*\*NOT GRANTED' "$project_dir/reports/PRODUCTION_CERTIFICATION_STATUS_0.2.0-rc.1.md"
grep -q 'Release disposition: \*\*EVALUATION ONLY' "$project_dir/reports/RELEASE_ACCEPTANCE_0.2.0-rc.1.md"
grep -q 'Production/customer deployment approval: \*\*NOT GRANTED' "$project_dir/reports/RELEASE_ACCEPTANCE_0.2.0-rc.1.md"
grep -q 'Commercial distribution approval: \*\*NOT GRANTED' "$project_dir/reports/RELEASE_ACCEPTANCE_0.2.0-rc.1.md"

if grep -RInE --exclude=static-checks.sh '(^|[^A-Za-z])(admin/admin|admin@nettap[.]local[[:space:]]*/[[:space:]]*admin)([^A-Za-z]|$)' \
  "$project_dir/README.md" "$project_dir/docs" "$project_dir/scripts" "$project_dir/tests"; then
  echo "ERROR: Shared default administrator credential found in active source." >&2
  exit 1
fi
if grep -RInE --exclude=static-checks.sh 'local -n|mapfile' "$project_dir/scripts" "$project_dir/tests"; then
  echo "ERROR: Bash feature unavailable in the Bash 3.2 shipped with macOS." >&2
  exit 1
fi
if grep -RInE '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})' \
  --exclude-dir=.git "$project_dir"; then
  echo "ERROR: Possible private key or GitHub token found." >&2
  exit 1
fi
if grep -InE 'no license (has|has yet) been selected|must select and add a license' \
  "$project_dir/README.md" "$project_dir/docs/"*.md "$project_dir/THIRD_PARTY_NOTICES.md"; then
  echo "ERROR: Stale project-license warning found." >&2
  exit 1
fi

python3 "$project_dir/tests/production-config-checks.py"
python3 - "$project_dir" <<'PY'
import re
import sys
from pathlib import Path
root = Path(sys.argv[1])
missing = []
pattern = re.compile(r'\[[^]]+\]\(([^)]+)\)')
for document in list(root.rglob('*.md')):
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
echo "Static checks passed."
