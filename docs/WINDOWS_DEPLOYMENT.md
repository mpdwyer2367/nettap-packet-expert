# Windows and WSL2 deployment guide

## Requirements

- Supported 64-bit Windows with virtualization enabled
- WSL2 and Docker Desktop using the WSL2 backend
- Git inside the selected WSL2 distribution
- 16 GB host RAM minimum (24 GB recommended), 12 GB Docker memory and at least 20 GiB free disk
- Internet access during the first controlled installation only

## Recommended WSL2 installation

From a WSL2 shell:

```bash
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
cd nettap-packet-expert
git rev-parse HEAD
./scripts/nettap-ai start-wsl2
```

Open <http://127.0.0.1:3100> from Windows. Sign in as `admin@nettap.local` using `.bootstrap-admin-password`, change the password, sign out and verify the generated password fails. Then run in WSL2:

```bash
./scripts/finalize-admin.sh --confirm
./scripts/verify-macos-deployment.sh --windows-wsl2
```

## Native PowerShell entry point

If the repository is stored on a Windows filesystem and Docker Desktop is available to PowerShell:

```powershell
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
Set-Location .\nettap-packet-expert
git rev-parse HEAD
.\scripts\start-windows.ps1
```

The recommended release-acceptance path is WSL2 because the same shell scripts and exact Git commit can be tested on both platforms.

## Verification and maintenance

```bash
./scripts/nettap-ai status
./scripts/nettap-ai health
docker compose --env-file .env -f compose.yaml -f compose.local.yaml logs --tail=200 open-webui ollama evidence-service
```

Attach the same representative PCAP, log, normalized flow and network-image fixtures used for macOS acceptance. Record Windows version, WSL distribution, Docker Desktop version, architecture, Git commit, package checksum, model ID and the generated verification report.

## Troubleshooting

- If port 3100 is refused, run `./scripts/nettap-ai repair-local`, then inspect `docker compose ... ps -a` and logs.
- If provisioning rejects a credential, the existing volume has its own current password. Use that account or run `./scripts/nettap-ai recover-admin --confirm --email admin@nettap.local` from WSL2 to back up the database and reset that exact account with a locally generated one-time password.
- If Ollama port 11434 is already used by a native process, no change is normally needed: the containerized Ollama is internal and publishes no host port. Confirm the running Compose configuration rather than starting a second native service.
- Do not delete volumes to repair login or port issues.

Follow [Administrator guide](ADMINISTRATION.md) for backup, restore, update, model retirement and production gates.
