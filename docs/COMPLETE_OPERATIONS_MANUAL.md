# NetTAP AI Suite operations manual

Release `0.3.0-rc.2` is an integration candidate for one single-node, single-customer Docker deployment. It is not a certified GA appliance until every commercial release gate passes.

## Components

| Component | Identity |
|---|---|
| Shared base | `qwen2.5:7b-instruct-q4_K_M` |
| Combined NetTAP AI model | `nettap-ai:0.3.0-rc.2` |
| Network profile | Workspace Model ID `nettap-network-visibility` over the combined model |
| Packet profile | Workspace Model ID `nettap-packet-expert` over the combined model |
| Local UI | `127.0.0.1:3100` |
| Network launcher | `127.0.0.1:3000` |
| Packet launcher | `127.0.0.1:3001` |
| Production gateway | HTTPS port `8443` by default |

## Installation

Use [macOS deployment](MACOS_DEPLOYMENT.md) or [Windows deployment](WINDOWS_DEPLOYMENT.md). Existing Packet Expert users must use [the migration guide](MIGRATION.md).

## Administrator activation

The first start generates a unique local credential. Change it, prove the old value fails, and run `./scripts/finalize-admin.sh --confirm`. A populated Open WebUI volume keeps its existing users and passwords. The suite never restores a shared default password.

## Routine commands

```bash
./scripts/nettap-ai status
./scripts/nettap-ai health
./scripts/nettap-ai update-models --confirm
./scripts/nettap-ai backup /secure/backup/path --confirm-stop
./scripts/nettap-ai stop
```

The compatibility command `./scripts/nettap-packet-expert` delegates to the unified CLI.

## Model and profile management

The combined Ollama policy loads when `nettap-ai` is created. Supplemental Markdown knowledge requires a controlled Open WebUI import and matching Workspace Model attachment. Both profiles use the same Ollama model; Git changes do not update deployed knowledge.

Follow [assistant customization](ASSISTANT_CUSTOMIZATION.md) and [knowledge management](KNOWLEDGE_MANAGEMENT.md). Keep the global application suggestions broad; the launchers and Workspace Models provide assistant-specific starting points.

## Backup

```bash
./scripts/backup.sh /secure/backup/path --confirm-stop
```

The command stops the application, archives the shared Open WebUI and Ollama volumes, records model and image identity, produces checksums, and restarts the prior mode. The backup contains accounts, chats, imported knowledge, settings, audit logs, and model data. Protect it as sensitive customer data.

## Restore

Restore never overwrites a volume:

```bash
./scripts/restore.sh /secure/backup/path --target-prefix customer-test
```

The restored volumes remain unconnected until an administrator reviews the manifest and explicitly attaches them through an approved recovery procedure.

## Updates

1. Back up the current release and `.env`.
2. Record the commit, image digests, model IDs, assistant manifests, and knowledge hashes.
3. Apply only an approved release.
4. Rebuild the one combined NetTAP AI model.
5. Run static, behavioral, runtime, storage, launcher, profile/knowledge-isolation, backup, restore, and rollback checks.
6. Preserve the prior release and volumes until acceptance is signed.

Changing the base model requires a separate model-evaluation release. Do not combine it with a repository or database migration.

## Troubleshooting

### Port already in use

Run `./scripts/inventory-macos.sh` on macOS. Identify the owning process before stopping anything. The suite requires local ports 3000, 3001, and 3100 unless `.env` is deliberately changed.

### Old suggestions remain

Open WebUI can retain persisted Workspace Model or global configuration. Inspect the selected model and its prompt suggestions. Update or replace the reviewed preset; do not delete the Open WebUI volume to repair suggestions.

### One profile is missing

Run `./scripts/nettap-ai update-models --confirm` and inspect `ollama list` for `nettap-ai:0.3.0-rc.2`. Then inspect the relevant Open WebUI Workspace Model preset and rerun the behavior tests. Do not create an unversioned substitute model from the UI.

### Existing login fails

Do not expect the generated bootstrap credential to reset a populated volume. Follow [authentication](AUTHENTICATION.md) and preserve the database before any approved recovery action.

### Live telemetry appears unavailable

That is the correct default. The release does not include a live NetTAP connector. A separate approved integration must supply current evidence and its provenance.

## Production controls

Production requires immutable image digests, matching security-scan evidence, customer TLS, finalized administrator activation, preflight, runtime verification, backup acceptance, external approvals, signed artifacts, and authorized release acceptance. See [commercial release gates](COMMERCIAL_RELEASE_GATES.md) and [tool security](TOOL_SECURITY.md).
