# Customer deployment guide

## Supported scope

Deploy one NetTAP Network Intelligence instance per customer or security boundary. The instance contains one shared NetTAP Network Intelligence Model, two Open WebUI experience profiles, one Open WebUI, and one Ollama model store. This guide covers the Docker software-appliance candidate on macOS, native Linux, or a Windows host running Docker Desktop with WSL 2/Linux containers. The target must meet the sizing and release gates for the exact commit and image digests.

## Customer prerequisites

- 8 CPUs, 16 GiB Docker memory, 40 GiB free disk minimum
- Customer-managed DNS name and PEM TLS certificate/unencrypted deployment private key with the correct SAN; protect the key through host file permissions and secret governance
- Inbound firewall permission only from authorized management/user networks to the selected HTTPS port
- Outbound registry access during installation/update only
- Host-disk encryption, time synchronization, endpoint protection, and protected off-host backups
- Named application owner, security owner, backup owner, and support contacts
- Approved data classification, retention, incident, and evidence-handling policy

## Installation

1. Verify the signed release package, checksum and signed provenance with `scripts/verify-release.sh`.
2. Extract it into a customer-owned directory with restricted permissions.
3. Start the loopback profile and replace the documented local administrator credential:

```bash
chmod +x scripts/* tests/*.sh
./scripts/start-macos.sh
```

On native Linux, use `scripts/start-linux.sh`. On Windows, use `scripts/start-windows.ps1` and complete the Bash steps from WSL. Fresh local installations write their login email and bootstrap password to the ignored, mode-0600 `.bootstrap-admin-password` file. Use that local file to sign in, change the password, verify rejection of the bootstrap credential, and run:

```bash
./scripts/finalize-admin.sh --confirm
```

4. Lock platform images and run the security gate:

```bash
./scripts/lock-images.sh --confirm
./scripts/security-scan.sh
```

5. Install the customer certificate:

```bash
./scripts/configure-production.sh \
  --hostname nettap-ai.customer.example \
  --certificate /secure/path/tls.crt \
  --private-key /secure/path/tls.key
```

6. Start and verify:

```bash
./scripts/production-preflight.sh
./scripts/start-production.sh
./scripts/verify-production-deployment.sh
./tests/model-behavior-eval.sh
```

## Knowledge configuration

Startup automatically reconciles the reviewed shared and specialist Markdown into three managed collections through supported Open WebUI APIs. It attaches shared knowledge to both Workspace Models, Network & Visibility knowledge only to its matching profile, Packet Expert knowledge only to Packet Expert, and the checksum-pinned evidence-ingestion filter only to Packet Expert. Both profiles use `nettap-ai:0.4.0-rc.1`. Confirm the recorded provisioning fingerprint, file hashes, exact embedding revision, managed Function identity, and `Offline RAG verification: PASS`. Knowledge and uploaded evidence remain untrusted model inputs; neither may override system policy. See [knowledge management](KNOWLEDGE_MANAGEMENT.md).

## Acceptance

Complete `reports/RELEASE_ACCEPTANCE_TEMPLATE.md` against the exact commit, image digests, host, DNS name, and model. Verify:

- only the TLS gateway is published;
- no temporary registry-egress network remains;
- default bootstrap credential is retired;
- signup, code execution, API keys, web search, user webhooks, and admin chat access are disabled;
- backup and restore into new volumes succeed;
- fourteen behavioral and combined-capability smoke cases pass;
- browser login, both launchers, profile switching, profile-specific prompts, and isolated specialist knowledge retrieval behave as documented;
- the actual Ollama model-store measurement confirms one approved base and one combined NetTAP custom model;
- no report contains credentials or customer evidence.

## Backup and recovery

```bash
./scripts/backup.sh /customer-protected/path/backup --confirm-stop
./scripts/restore.sh /customer-protected/path/backup --target-prefix acceptance-restore
./tests/backup-restore-e2e.sh
```

Backups contain accounts, chats, knowledge, and model data. Encrypt and restrict them. The command briefly stops and restarts the application to obtain consistent SQLite/vector/model files. Its manifest records the release, model IDs, source identity and approved image references. Restore requires the matching software release, creates new volumes and never overwrites existing ones. Cross-version migration and connecting restored volumes to a deployment are deliberate change procedures and are not automated.

## Update and rollback

1. Back up and test restore.
2. Review release notes, licenses, image digests, SBOM, vulnerabilities, and known issues.
3. Stage the new release using the approved [migration procedure](MIGRATION.md); do not invent a database merge.
4. Run all acceptance tests.
5. Schedule a change window and switch the customer endpoint.
6. Retain the prior signed package and volumes for the approved rollback window.

Do not run an unreviewed `git pull` directly against a customer deployment. Do not use `docker compose down -v`; it deletes customer data.

## Monitoring

Run `scripts/healthcheck.sh` from the customer monitoring system. Collect host, Docker, gateway access, and application logs under customer retention rules. Never place prompts, chats, packet payload, secrets, or authentication material into public support tickets.
