# Administrator guide

Run commands from the repository root. The canonical Compose project is `nettap-network-intelligence`; its public repository remains `mpdwyer2367/nettap-packet-expert` until an approved repository rename and redirect are completed.

## Command reference

| Task | Command | Notes |
|---|---|---|
| Start macOS | `./scripts/nettap-ai start-local` | Controlled downloads, offline RAG, model build and assistant provisioning |
| Start Windows/WSL2 | `./scripts/nettap-ai start-wsl2` | Run inside the cloned WSL2 directory |
| Show status | `./scripts/nettap-ai status` | Lists services, Ollama models and UI URL |
| Health check | `./scripts/nettap-ai health` | Verifies the active local or TLS endpoint |
| Verify runtime | `./scripts/verify-macos-deployment.sh` | Use `--windows-wsl2` on WSL2 |
| View logs | `docker compose --env-file .env -f compose.yaml -f compose.local.yaml logs --tail=200 open-webui ollama evidence-service` | Add `-f` to follow |
| Restart services | `docker compose --env-file .env -f compose.yaml -f compose.local.yaml restart` | Preserves volumes |
| Repair local ports | `./scripts/nettap-ai repair-local` | Recreates local interfaces and verifies port 3100 |
| Reconcile assistant/RAG | `./scripts/nettap-ai provision-assistants --confirm` | Prompts for current admin credential when required |
| Recover sole admin | `./scripts/nettap-ai recover-admin --confirm` | Backs up DB, resets canonical admin and invalidates sessions; requires exactly one admin |
| Finalize first login | `./scripts/finalize-admin.sh --confirm` | Retires bootstrap credential after password change is verified |
| Rebuild approved model | `./scripts/nettap-ai update-models --confirm` | Uses temporary egress, revalidates and returns offline |
| List retired tags | `./scripts/nettap-ai retire-old-models` | Dry run |
| Remove retired tags | `./scripts/nettap-ai retire-old-models --confirm` | Never removes the current model or non-NetTAP models |
| Create backup | `./scripts/nettap-ai backup /absolute/secure/path --confirm-stop` | Briefly stops the stack for a consistent volume backup |
| Restore backup | `./scripts/restore.sh /absolute/backup --target-prefix test-restore` | Restores only into new volumes; never overwrites |
| Stop | `./scripts/nettap-ai stop` | Preserves volumes |
| Lock images | `./scripts/nettap-ai lock-images --confirm` | Converts approved image tags to immutable digests |
| Security scan | `./scripts/nettap-ai scan` | Produces release evidence; tool prerequisites apply |
| Production preflight | `./scripts/production-preflight.sh` | Requires TLS, digest pins, scans and finalized admin |
| Start production | `./scripts/nettap-ai start-production` | Publishes one TLS UI |
| Verify production | `./scripts/nettap-ai verify-production` | Must pass on the release host |
| Release certification | `./scripts/nettap-ai certify` | Evidence gate, not a substitute for approval |

## Authentication workflow

Fresh installations create `admin@nettap.local` with a unique random password in `.bootstrap-admin-password`. No password, personal email or account database is committed. Sign in at port 3100, change the password, sign out, confirm the generated password no longer works, then finalize it. Existing volumes retain their own account database and password.

If there are multiple administrators, do not use the single-admin recovery script. An authorized administrator should manage users in Open WebUI or follow a reviewed database-recovery procedure. Never delete the volume just to solve a login problem.

## Routine maintenance

Daily: check health, container state, disk capacity and failed login/audit events. Weekly: review backups, image advisories, provisioning drift and evidence-retention capacity. Before every update: back up, record the Git commit and model identity, review release notes and test rollback.

Useful inspection commands:

```bash
docker compose --env-file .env -f compose.yaml -f compose.local.yaml ps -a
docker compose --env-file .env -f compose.yaml -f compose.local.yaml exec -T ollama ollama list
docker compose --env-file .env -f compose.yaml -f compose.local.yaml exec -T ollama ollama show nettap-ai:0.3.0-rc.8
docker volume ls --filter label=com.docker.compose.project=nettap-network-intelligence
docker compose --env-file .env -f compose.yaml -f compose.local.yaml config
curl -fsS http://127.0.0.1:3100/health
```

## Backup and rollback

Backups include Ollama, Open WebUI and evidence volumes plus a manifest and checksums. Keep `.env`, TLS keys and backup archives in an approved secrets/backup system, not Git. Restore creates disconnected volumes under a new prefix so an administrator can validate them before a planned cutover. Rollback means deploying the prior signed source/package with its matching images, model identity and schema-compatible backup; never relabel an RC8 model as an older release.

## GitHub maintenance

Use protected `main`, short-lived branches, required tests and reviewed pull requests. A release should include the exact Git commit, source archive checksum, SBOM, vulnerability disposition, signed artifacts, macOS and Windows/WSL2 reports, backup/restore/rollback results and authorized legal/support/commercial approvals. Do not commit `.env`, bootstrap credentials, evidence tokens, customer evidence, databases, backups, TLS private keys or model blobs.
