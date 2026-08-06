# NetTAP Network Intelligence administration

Use the unified command:

```bash
./scripts/nettap-ai help
./scripts/nettap-ai status
./scripts/nettap-ai health
./scripts/nettap-ai update-models --confirm
./scripts/nettap-ai retire-old-models
./scripts/nettap-ai retire-old-models --confirm
./scripts/nettap-ai provision-assistants --confirm
./scripts/nettap-ai backup /secure/backup/path --confirm-stop
./scripts/nettap-ai stop
```

The legacy `scripts/nettap-packet-expert` command remains as a compatibility wrapper for the 0.3 migration.

## Daily checks

- Confirm the expected services are healthy.
- Confirm `nettap-ai:0.3.0-rc.3` appears in `ollama list` and is the only NetTAP model selected by the current release.
- Confirm Ollama is not published on a host port.
- Confirm the Open WebUI audit log is writable and rotating.
- Confirm the embedding and provisioning state files match the current release and show an offline RAG PASS.
- Confirm the latest backup completed and is protected.
- Confirm no unapproved tools, knowledge, models, or public-sharing permissions were enabled.

## Update sequence

1. Back up data and `.env` using [the migration procedure](MIGRATION.md).
2. Review release notes, image digests, model ID, security scan, and rollback requirements.
3. Apply the approved source release.
4. Rebuild the shared model with `./scripts/nettap-ai update-models --confirm`.
5. Run static, behavioral, runtime, launcher, backup, and restore acceptance.
6. Update managed Workspace Models and knowledge only through a reviewed source change followed by `./scripts/nettap-ai provision-assistants --confirm`.

## Data locations

The Compose project retains two persistent volumes:

- `nettap-packet-expert_packet-expert-open-webui-data`: accounts, chats, application settings, managed/customer knowledge, exact-revision embedding cache, provisioning state, and audit log.
- `nettap-packet-expert_packet-expert-ollama-data`: base model, shared Network Intelligence model manifest, and any retained rollback tags.

The launchers are stateless. Removing or recreating the launcher container does not remove chats or models.

## One-model lifecycle

The appliance installs one current NetTAP Network Intelligence Model and two
lightweight Open WebUI experience profiles. The profiles do not download or
duplicate the Qwen 7B weights. Ollama may retain older NetTAP tags after an
upgrade so a tested rollback remains possible; a retained tag consumes model
store space only when it uniquely references blobs and does not run a second
inference service.

After the current deployment has passed backup, restart, both-experience and
rollback acceptance, preview retirement:

```bash
./scripts/nettap-ai retire-old-models
```

Then remove only retired NetTAP tags from the containerized appliance store:

```bash
./scripts/nettap-ai retire-old-models --confirm
```

On Windows PowerShell use:

```powershell
.\scripts\retire-legacy-models.ps1
.\scripts\retire-legacy-models.ps1 -Confirm
```

An older native Ollama installation is a separate store. Use
`--include-native` or `-IncludeNative` only after the dry run proves that the
containerized current model is healthy and the listed native NetTAP tags are no
longer needed. The command never removes non-NetTAP models, the approved Qwen
base, Open WebUI data, knowledge, evidence or Docker volumes.

## Incident handling

If an assistant, knowledge collection, or tool behaves unexpectedly:

1. Disable the affected Workspace Model or tool.
2. Preserve audit logs, configuration exports, hashes, timestamps, and the relevant chat under the customer's policy.
3. Do not delete volumes or rebuild the database as an initial response.
4. Roll back to the last approved assistant and knowledge versions.
5. Document the cause, exposure, corrective action, and retest evidence.
