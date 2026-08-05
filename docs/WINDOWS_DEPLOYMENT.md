# Windows deployment

## Evaluation profile

Requirements: supported Windows 10/11, hardware virtualization, WSL 2, current Docker Desktop using Linux containers, Git, 16 GiB system memory recommended, and 15 GiB free disk.

In PowerShell:

```powershell
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
Set-Location .\nettap-packet-expert
.\scripts\start-windows.ps1
```

If local policy blocks the script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1
```

Open <http://127.0.0.1:3001>. Use `admin@nettap.local` and the locally generated password file. Change it and verify rejection of the generated value. From WSL Ubuntu or Git Bash in the repository:

```bash
./scripts/finalize-admin.sh --confirm
./scripts/install-openwebui-bundle.sh
python3 -m pip install -r requirements-validation.txt
./tests/static-checks.sh
./tests/model-behavior-eval.sh
```

PowerShell runtime checks:

```powershell
$compose = @('compose','--env-file','.env','-f','compose.yaml','-f','compose.local.yaml')
docker @compose ps
docker @compose exec -T ollama ollama show nettap-packet-expert:latest
Invoke-WebRequest http://127.0.0.1:3001/health -UseBasicParsing
```

Record Windows build, architecture, Docker Desktop/Engine/Compose versions, CPU/memory allocation, commit, image digests, model identity, browser results, and tester.

In Open WebUI, import `knowledge/NetTAP_Packet_Expert_Knowledge.md`, verify its
SHA-256 against `knowledge/manifest.json`, restrict access, and attach it to the
Packet Expert workspace model. Windows runtime validation must confirm all six
specialist suggestion cards and the installed Packet Expert skill.

## Production candidate

Use WSL Ubuntu for the production Bash tooling and keep source/certificates on a Linux filesystem with restricted permissions. Production requires at least 8 Docker CPUs, 16 GiB Docker memory, 40 GiB free disk, customer TLS, immutable digests, security scan, backup/restore test, production runtime verification, and signed acceptance.

Windows production is **not validated by source CI**. Complete a fresh physical-host run for every supported Windows/Docker configuration before advertising it. Follow [the customer deployment guide](CUSTOMER_DEPLOYMENT_GUIDE.md).
