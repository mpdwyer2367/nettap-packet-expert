# NetTAP AI Suite administration

Use the unified command:

```bash
./scripts/nettap-ai help
./scripts/nettap-ai status
./scripts/nettap-ai health
./scripts/nettap-ai update-models --confirm
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
4. Rebuild the combined model with `./scripts/nettap-ai update-models --confirm`.
5. Run static, behavioral, runtime, launcher, backup, and restore acceptance.
6. Update managed Workspace Models and knowledge only through a reviewed source change followed by `./scripts/nettap-ai provision-assistants --confirm`.

## Data locations

The Compose project retains two persistent volumes:

- `nettap-packet-expert_packet-expert-open-webui-data`: accounts, chats, application settings, managed/customer knowledge, exact-revision embedding cache, provisioning state, and audit log.
- `nettap-packet-expert_packet-expert-ollama-data`: base model, combined NetTAP AI manifest, and any retained rollback tags.

The launchers are stateless. Removing or recreating the launcher container does not remove chats or models.

## Incident handling

If an assistant, knowledge collection, or tool behaves unexpectedly:

1. Disable the affected Workspace Model or tool.
2. Preserve audit logs, configuration exports, hashes, timestamps, and the relevant chat under the customer's policy.
3. Do not delete volumes or rebuild the database as an initial response.
4. Roll back to the last approved assistant and knowledge versions.
5. Document the cause, exposure, corrective action, and retest evidence.
