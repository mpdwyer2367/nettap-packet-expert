# NetTAP Network Intelligence operations manual

Release `0.4.0-rc.1` is an integration candidate for one single-node, single-customer Docker deployment. It is not a certified GA appliance until every commercial release gate passes.

## Components

| Component | Identity |
|---|---|
| Shared base | `qwen3.5:9b-q4_K_M` |
| Shared NetTAP Network Intelligence Model | `nettap-ai:0.4.0-rc.1` |
| Network profile | Workspace Model ID `nettap-network-visibility` over the combined model |
| Packet profile | Workspace Model ID `nettap-packet-expert` over the combined model |
| Local UI | `127.0.0.1:3100` |
| Evidence Workspace | `127.0.0.1:3200` with generated bearer token |
| Network launcher | `127.0.0.1:3000` |
| Packet launcher | `127.0.0.1:3001` |
| Production gateway | HTTPS port `8443` by default |

## Installation

Use [macOS deployment](MACOS_DEPLOYMENT.md) or [Windows deployment](WINDOWS_DEPLOYMENT.md). Existing Packet Expert users must use [the migration guide](MIGRATION.md).

## Administrator activation

The first local start uses `admin@nettaptech.com` with `Password!`. Change it, prove the default value fails, and run `./scripts/finalize-admin.sh --confirm`. A populated Open WebUI volume keeps its existing users and passwords unless an operator explicitly runs the loopback-only default recovery command. Production preflight rejects the default password.

## Routine commands

```bash
./scripts/nettap-ai status
./scripts/nettap-ai health
./scripts/nettap-ai update-models --confirm
./scripts/nettap-ai provision-assistants --confirm
./scripts/nettap-ai backup /secure/backup/path --confirm-stop
./scripts/nettap-ai stop
```

The compatibility command `./scripts/nettap-packet-expert` delegates to the unified CLI.

## Model and profile management

The combined Ollama policy loads when `nettap-ai` is created. Startup then reconciles supplemental Markdown and matching Workspace Model attachments through supported Open WebUI APIs and proves offline retrieval before enabling the launchers. Both profiles use the same Ollama model. After a reviewed Git change, run `./scripts/nettap-ai provision-assistants --confirm`; the fingerprint prevents unnecessary repeated ingestion.

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
4. Rebuild the one shared NetTAP Network Intelligence Model.
5. Run static, behavioral, runtime, storage, launcher, profile/knowledge-isolation, backup, restore, and rollback checks.
6. Preserve the prior release and volumes until acceptance is signed.

Changing the base model requires a separate model-evaluation release. Do not combine it with a repository or database migration.

## Troubleshooting

### Port already in use

Run `./scripts/inventory-macos.sh` on macOS. Identify the owning process before stopping anything. The platform requires local ports 3000, 3001, 3100, and 3200 unless `.env` is deliberately changed.

### Old suggestions remain

Run `./scripts/nettap-ai provision-assistants --confirm`, then inspect the managed profile and provisioning state. The command reconciles reviewed suggestions and model defaults without deleting accounts or chats. Do not delete the Open WebUI volume to repair suggestions.

### One profile is missing

Run `./scripts/nettap-ai update-models --confirm` and inspect `ollama list` for `nettap-ai:0.4.0-rc.1`. The update also refreshes the pinned offline embedding cache, reconciles the managed profiles, and, after those checks pass, retires older NetTAP container tags. Review the provisioning state and rerun the behavior tests. Do not create an unversioned substitute model from the UI.

### Existing login fails

Do not expect bootstrap environment values to reset a populated volume. Follow [authentication](AUTHENTICATION.md) and use the supported recovery command, which backs up the database before changing the retained administrator.

### Live telemetry appears unavailable

That is the correct default. The release does not include a live NetTAP connector. A separate approved integration must supply current evidence and its provenance.

## Production controls

Production requires immutable image digests, matching security-scan evidence, customer TLS, finalized administrator activation, preflight, runtime verification, backup acceptance, external approvals, signed artifacts, and authorized release acceptance. See [commercial release gates](COMMERCIAL_RELEASE_GATES.md) and [tool security](TOOL_SECURITY.md).
