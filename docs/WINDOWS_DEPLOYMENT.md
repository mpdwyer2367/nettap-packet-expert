# Windows deployment and acceptance

## Supported release-candidate path

- Windows 11 or a Microsoft-supported Windows 10 release
- Docker Desktop using the WSL 2 backend and Linux containers
- Docker Compose v2 (`docker compose`)
- Git for Windows and Windows PowerShell 5.1 or PowerShell 7+
- Hardware virtualization enabled in firmware
- 16 GB host memory recommended; 8 GB is a constrained evaluation floor
- 15 GB free disk minimum on the drive holding Docker Desktop data
- Browser access to `http://127.0.0.1:3001`

The default deployment runs Ollama and Open WebUI in Linux containers. It does not require a separate Windows Ollama installation.

## Install prerequisites

1. Install Git for Windows.
2. Install Docker Desktop and enable **Use the WSL 2 based engine**.
3. Keep Docker Desktop in **Linux containers** mode.
4. Start Docker Desktop and wait until the engine is running.
5. Open PowerShell and verify:

```powershell
docker version
docker compose version
git --version
```

## Install and run

```powershell
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
Set-Location nettap-packet-expert
powershell -ExecutionPolicy Bypass -File .\scripts\Start-Windows.ps1
```

The launcher performs preflight checks, creates `.env` with a random WebUI secret, validates Compose, pulls pinned images, creates the custom model, and starts Open WebUI.

Open `http://127.0.0.1:3001`. The first account becomes administrator; later registrations remain pending until approved. The first run downloads container images and the approximately 4.7 GB base model.

After first-admin creation, `workspace-init` privately imports and indexes the knowledge file, installs the formal Skill, attaches both to Packet Expert, and validates retrieval. The Windows acceptance harness repeats that check.

## Validate the deployment

```powershell
powershell -ExecutionPolicy Bypass -File .\tests\Windows-E2E.ps1
```

The harness checks source controls, model identity, controlled inference, WebUI health, loopback publishing, and restart persistence. It writes a timestamped report under `reports\`.

Complete these manual checks before publishing Windows support:

- First user becomes admin and can sign out and back in.
- Packet Expert is selected and returns a response.
- Four starter prompts appear.
- The interface remains available after Docker Desktop restarts.
- Port 3001 is locally reachable but unavailable from another computer.
- No real customer capture, credential, secret, or personal data is present.

## Daily operation

```powershell
.\scripts\Status-Windows.ps1
.\scripts\Stop-Windows.ps1
.\scripts\Update-Release-Windows.ps1 -Confirm
```

Stopping services preserves users, chats, models, and configuration. Never run `docker compose down -v` unless permanent deletion of named-volume data is intended.

## Troubleshooting

- **Port 3001 is occupied:** change `WEB_PORT` in `.env`, rerun the launcher, and keep `BIND_ADDRESS=127.0.0.1`.
- **Open WebUI does not load:** run `docker compose --env-file .env -f compose.yaml ps` and `docker compose --env-file .env -f compose.yaml logs --tail 200 open-webui ollama`.
- **Model creation fails or disk fills:** free space on Docker Desktop's data drive, restart Docker Desktop, and rerun the launcher. Existing completed downloads are reused.
- **WSL or virtualization errors:** run `wsl --status`, install current Windows updates, and verify firmware virtualization is enabled.

Work with the authorized administrator rather than disabling endpoint security or organizational controls.

## Upgrade and rollback

Back up or snapshot the Docker volumes, pull the reviewed repository revision, review `.env.example`, `compose.yaml`, and `model/Modelfile`, retain the existing `.env` and volumes, then rerun the launcher and acceptance harness.

For rollback, check out the previously approved tag or commit and restart its pinned images. Review Open WebUI database compatibility before downgrading; persistent data is not rolled back with source files.
