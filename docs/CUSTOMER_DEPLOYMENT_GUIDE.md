# Customer deployment guide

## Supported scope

Deploy one NetTAP Packet Expert instance per customer or security boundary. This guide covers the hardened Docker software-appliance candidate on macOS or a Windows host running Docker Desktop with WSL 2/Linux containers. The target must meet the sizing and release gates for the exact commit and image digests.

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
3. Start the loopback profile and activate the generated administrator:

```bash
chmod +x scripts/* tests/*.sh
./scripts/start-macos.sh
```

On Windows, use `scripts/start-windows.ps1` and complete the Bash steps from WSL. The credential appears only in the ignored local `.bootstrap-admin-password` file. Change it, verify rejection of the generated credential, and run:

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
  --hostname packet-expert.customer.example \
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

Import `knowledge/NetTAP_Packet_Expert_Knowledge.md` in **Workspace > Knowledge**, grant only intended users read access, and attach it to the Packet Expert model. Record the file hash and import date. Knowledge and uploaded evidence are untrusted model inputs; neither may override the system policy.

## Acceptance

Complete `reports/RELEASE_ACCEPTANCE_TEMPLATE.md` against the exact commit, image digests, host, DNS name, and model. Verify:

- only the TLS gateway is published;
- no temporary registry-egress network remains;
- generated bootstrap credential is retired;
- signup, code execution, API keys, web search, user webhooks, and admin chat access are disabled;
- backup and restore into new volumes succeed;
- six model guardrail tests pass;
- browser login, chat, starter prompts, model selection, and knowledge retrieval behave as documented;
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
3. Stage the new release in a separate directory and separate volumes.
4. Run all acceptance tests.
5. Schedule a change window and switch the customer endpoint.
6. Retain the prior signed package and volumes for the approved rollback window.

Do not run an unreviewed `git pull` directly against a customer deployment. Do not use `docker compose down -v`; it deletes customer data.

## Monitoring

Run `scripts/healthcheck.sh` from the customer monitoring system. Collect host, Docker, gateway access, and application logs under customer retention rules. Never place prompts, chats, packet payload, secrets, or authentication material into public support tickets.
