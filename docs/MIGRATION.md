# Migration from standalone Packet Expert to NetTAP Network Intelligence

This migration preserves the existing Open WebUI and Ollama volumes. It does not merge SQLite databases, copy password hashes, or attach one data volume to concurrent Open WebUI containers.

## Supported source

The automated environment migration recognizes the repository's `0.2.0-rc.1` configuration. Earlier experimental deployments require inventory and a controlled export/import rather than an in-place assumption.

## Before changing the checkout

Run these steps using the existing `0.2.0-rc.1` code:

```bash
./scripts/inventory-macos.sh > nettap-pre-migration-inventory.txt
./scripts/backup.sh /secure/path/nettap-pre-migration --confirm-stop
cp .env /secure/path/nettap-pre-migration.env
chmod 600 /secure/path/nettap-pre-migration.env
git rev-parse HEAD > /secure/path/nettap-pre-migration-commit.txt
```

The backup and `.env` contain sensitive operational data or secrets. Keep them outside Git with customer-approved access control and encryption.

Confirm the backup contains `manifest.txt`, `SHA256SUMS`, `ollama-data.tgz`, and `open-webui-data.tgz`. Do not delete or rename the existing Docker volumes.

## Upgrade the source

Use the reviewed release tag or approved commit. Do not migrate from an unreviewed branch in a customer environment.

```bash
git fetch --tags origin
git switch <approved-release-tag-or-branch>
chmod +x scripts/* tests/*.sh
./tests/static-checks.sh
```

For local macOS evaluation:

```bash
./scripts/start-macos.sh
```

For Windows:

```powershell
.\scripts\start-windows.ps1
```

Initialization performs these bounded changes:

1. Updates recognized 0.2, 0.3-rc.1, and 0.3-rc.2 environment defaults to the 0.3-rc.3 suite values.
2. Retains the Compose project name so existing volumes remain attached.
3. Pulls the same approved Qwen2.5 7B base model and verifies its expected ID.
4. Creates one combined `nettap-ai:0.3.0-rc.3` model.
5. Caches the exact approved embedding-model revision during temporary egress, then removes that egress.
6. Starts Open WebUI in offline mode, reconciles three managed knowledge collections and two Workspace Models through supported APIs, and proves local retrieval.
7. Starts the two stateless launcher pages only after provisioning succeeds.

It does not automatically remove old Packet Expert or Network & Visibility model tags, modify Open WebUI tables directly, or delete retired environment variables. Old tags remain available for rollback until an administrator removes them after acceptance. The provisioner adopts only recognized NetTAP RC1/RC2 profiles, preserves their access grants, and refuses unmanaged naming or file conflicts.

After backup, restart, both-experience and rollback acceptance, run
`./scripts/nettap-ai retire-old-models` to preview the exact appliance tags that
would be removed. Rerun with `--confirm` to retain only the current NetTAP model
tag in the containerized Ollama store. Add `--include-native` only after
reviewing a separate host-native Ollama store. This retirement does not delete
the shared base model, non-NetTAP models, accounts, chats, knowledge, evidence
or Docker volumes.

## Application migration

1. Sign in with the existing administrator account. A populated Open WebUI volume keeps its existing accounts and passwords; the bootstrap credential is not reapplied.
2. Confirm existing chats are present.
3. Confirm `nettap-ai:0.3.0-rc.3` appears in the model selector and that the retired assistant tags are not selected by default.
4. Confirm the installation reported `Offline RAG verification: PASS` and created the shared, Network & Visibility, and Packet Expert managed collections.
5. Confirm both managed Workspace Models use the same `nettap-ai` base, shared knowledge is attached to both, and each specialist collection is attached only to its matching profile.
6. Keep legacy or customer-created collections outside the managed NetTAP collection names; review and migrate them separately.
7. If provisioning reports an unmanaged conflict, back up and rename or relocate that content after review; do not bypass the check or edit SQLite directly.

## Acceptance

```bash
./tests/static-checks.sh
./tests/model-behavior-eval.sh
./tests/model-storage-sharing.sh
./tests/backup-restore-e2e.sh
```

On macOS also run:

```bash
./tests/macos-e2e.sh
```

Manually verify:

- port 3000 opens Network & Visibility;
- port 3001 opens Packet Expert;
- port 3100 is one shared Open WebUI;
- port 3200 is the separate authenticated Evidence Workspace;
- assistant switching does not require a second login;
- existing chats and accounts remain available;
- both profiles use the same `nettap-ai:0.3.0-rc.3` runtime model;
- each profile retains its intended name, prompts, specialist knowledge, and permissions;
- no assistant claims unavailable live data; and
- a new backup and non-overwriting restore pass.

Record disk use before and after. The release creates one combined NetTAP custom model over one base weight set, but customer acceptance must measure the actual model store instead of relying on an assumed byte count.

## Rollback

If acceptance fails:

1. Stop the product with `./scripts/stop.sh`.
2. Return to the recorded `0.2.0-rc.1` commit.
3. Restore the protected pre-migration `.env`.
4. Start the prior profile and validate its health.
5. Preserve the failed 0.3 volumes and reports for diagnosis; do not delete them as a repair step.

Because the in-place upgrade may add model tags and Open WebUI may perform its own schema migration, a customer rollback decision must use the protected pre-migration backup when the prior application cannot safely open the upgraded data volume.

## Repository transition

Keep this repository and its history as the canonical engineering source during the 0.3 release-candidate cycle. Add a migration notice to the incomplete `nettap-private-ai-deployment` repository and archive it only after the unified candidate passes target-host acceptance. Do not delete historical tags or the `0.2.0-rc.1` evidence record.
