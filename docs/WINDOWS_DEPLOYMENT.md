# Windows deployment and acceptance

## Supported release-candidate path

- Windows 11 or a supported Windows 10 release
- Hardware virtualization enabled
- WSL 2
- Docker Desktop using Linux containers and Docker Compose v2
- Git and PowerShell
- 16 GB host memory recommended; 8 GB is a constrained evaluation floor
- 15 GB free disk minimum

This is a CPU-compatible evaluation profile. The supplied Compose file does not request GPU access. Do not advertise Windows GPU acceleration until a separate profile has been implemented and tested.

## Install and run

1. Install Git and Docker Desktop.
2. Enable the WSL 2 Docker engine and start Docker Desktop.
3. Open PowerShell as the normal user.
4. Run:

```powershell
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
Set-Location .\nettap-packet-expert
.\scripts\start-windows.ps1
```

If PowerShell policy blocks the signed status of the local script, use this one-time process invocation:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1
```

The script generates the Open WebUI application secret, validates Docker, pulls the pinned images, starts Ollama, builds the custom model, and starts Open WebUI.

## Secure the administrator

1. Open `http://127.0.0.1:3001`.
2. For a fresh data volume, sign in with `admin@nettap.local` and temporary password `admin`.
3. Open **Settings > Account** and replace the temporary password.
4. Sign out and confirm the old password fails and the new password succeeds.

Existing volumes retain their existing accounts. Bootstrap credentials never reset an existing administrator. See [Administrator bootstrap and account access](AUTHENTICATION.md).

## Runtime checks

```powershell
$compose = @('compose', '--env-file', '.env', '-f', 'compose.yaml')
docker @compose ps
docker @compose exec -T ollama ollama show nettap-packet-expert:0.1.0-rc.8
docker @compose exec -T ollama ollama run nettap-packet-expert:0.1.0-rc.8 `
  'Ask one important question and do not claim that you have live packet data.'
Invoke-WebRequest http://127.0.0.1:3001/health -UseBasicParsing
```

Expected results:

- Ollama and Open WebUI are running.
- The custom model is present and returns a non-empty response.
- The UI health endpoint succeeds.
- The model does not claim live traffic access.
- The administrator password-change acceptance steps pass.
- Four broad starter prompts are visible.

No automated Windows runtime harness is included in RC8. Record the host version, architecture, Docker Desktop version, Compose version, allocated CPU/memory, image digests, test time, and results before advertising Windows validation.

## Stop and restart

```powershell
$compose = @('compose', '--env-file', '.env', '-f', 'compose.yaml')
docker @compose down
docker @compose up -d
```

Named volumes are preserved. Never add `-v` unless permanent deletion of users, chats, settings, knowledge, and models is intended.
