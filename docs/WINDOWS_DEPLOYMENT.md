# Windows deployment

## Requirements

- Supported 64-bit Windows host
- WSL 2 enabled
- Docker Desktop using Linux containers
- Git and PowerShell
- At least 15 GiB free disk for evaluation
- Recommended Docker allocation: 8 CPUs and 16 GiB memory

## New installation

```powershell
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
Set-Location .\nettap-packet-expert
.\scripts\start-windows.ps1
```

The installer force-recreates the browser-facing services after provisioning
and does not report success until ports 3000, 3001, 3100, and 3200 are bound to
`127.0.0.1` and all four health endpoints respond. Persistent model, account,
chat, knowledge, and case volumes are not removed.

The first start downloads the approved Qwen2.5 7B base and exact offline embedding revision, verifies them, builds one combined `nettap-ai:0.3.0-rc.5` model, removes temporary egress, provisions three knowledge collections and two Workspace Models, proves offline retrieval, retires older NetTAP container tags, and then starts one Open WebUI with two stateless experience launchers.

Open:

- <http://127.0.0.1:3000> — Network & Visibility
- <http://127.0.0.1:3001> — Packet Expert
- <http://127.0.0.1:3100> — shared Open WebUI
- <http://127.0.0.1:3200> — authenticated local Evidence Workspace; token in `.evidence-api-token`

Use `admin@nettap.local` with the locally generated password file printed by the script. Change it immediately and verify the generated value fails. Complete administrator finalization from WSL or Git Bash as described in [authentication](AUTHENTICATION.md).

## Verification

```powershell
docker compose --env-file .env -f compose.yaml -f compose.local.yaml ps
docker compose --env-file .env -f compose.yaml -f compose.local.yaml exec -T ollama ollama show nettap-ai:0.3.0-rc.5
Invoke-WebRequest http://127.0.0.1:3100/health -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:3200/health -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:3000/ -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:3001/ -UseBasicParsing
docker compose --env-file .env -f compose.yaml -f compose.local.yaml exec -T open-webui python -c "import json; from pathlib import Path; print(json.loads(Path('/app/backend/data/nettap-provisioning-state.json').read_text())['offline_rag']['result'])"
```

Windows runtime acceptance must record the Windows build, WSL version, Docker Desktop version, CPU architecture, container image digests, base and combined model IDs, both profile responses, both launcher results, login and password-change result, restart persistence, backup, restore, and rollback.

The supplied profile is CPU-compatible and does not claim Windows GPU acceleration. Existing Packet Expert 0.2 users must follow [the migration guide](MIGRATION.md).

## Clean release acceptance in WSL2

Use the exact signed package used by the macOS tester. From an Ubuntu WSL2 shell with Docker Desktop integration enabled:

```bash
chmod +x scripts/* tests/*.sh
./tests/clean-package-acceptance.sh \
  --archive /mnt/c/approved/nettap-ai-suite-0.3.0-rc.5-source.tar.gz \
  --evidence-dir /mnt/c/protected/nettap-rc3-windows \
  --public-key /mnt/c/approved/cosign.pub
```

The evidence directory must be empty. The test verifies WSL2, starts a unique clean Compose project, and records Windows/WSL2 acceptance against the package commit, tree, and SHA-256. `--allow-unsigned-evaluation` is not acceptable for release evidence. After both platform runs, compare their summaries as described in [the RC5 acceptance plan](RC5_ACCEPTANCE_PLAN.md).
