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

The first start downloads the approved Qwen2.5 7B base once, verifies its expected ID, builds one combined `nettap-ai:0.3.0-rc.2` model, and starts one Open WebUI with two stateless experience launchers.

Open:

- <http://127.0.0.1:3000> — Network & Visibility
- <http://127.0.0.1:3001> — Packet Expert
- <http://127.0.0.1:3100> — shared Open WebUI

Use `admin@nettap.local` with the locally generated password file printed by the script. Change it immediately and verify the generated value fails. Complete administrator finalization from WSL or Git Bash as described in [authentication](AUTHENTICATION.md).

## Verification

```powershell
docker compose --env-file .env -f compose.yaml -f compose.local.yaml ps
docker compose --env-file .env -f compose.yaml -f compose.local.yaml exec -T ollama ollama show nettap-ai:0.3.0-rc.2
Invoke-WebRequest http://127.0.0.1:3100/health -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:3000/ -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:3001/ -UseBasicParsing
```

Windows runtime acceptance must record the Windows build, WSL version, Docker Desktop version, CPU architecture, container image digests, base and combined model IDs, both profile responses, both launcher results, login and password-change result, restart persistence, backup, restore, and rollback.

The supplied profile is CPU-compatible and does not claim Windows GPU acceleration. Existing Packet Expert 0.2 users must follow [the migration guide](MIGRATION.md).
