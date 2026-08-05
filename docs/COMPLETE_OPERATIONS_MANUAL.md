# NetTAP Packet Expert operations manual

Release `0.3.0-rc.1` is a production-hardening candidate for a single-node, single-customer Docker software appliance. It is not a certified GA appliance until every [commercial release gate](COMMERCIAL_RELEASE_GATES.md) passes.

## Sources of truth

| Subject | File |
|---|---|
| Architecture and boundaries | [PRODUCTION_ARCHITECTURE.md](PRODUCTION_ARCHITECTURE.md) |
| Customer installation and recovery | [CUSTOMER_DEPLOYMENT_GUIDE.md](CUSTOMER_DEPLOYMENT_GUIDE.md) |
| Authentication | [AUTHENTICATION.md](AUTHENTICATION.md) |
| Threats and controls | [THREAT_MODEL.md](THREAT_MODEL.md) |
| Current evidence | [VALIDATION_STATUS.md](VALIDATION_STATUS.md) |
| Acceptance | [release template](../reports/RELEASE_ACCEPTANCE_TEMPLATE.md) |

## Product inventory

| Item | Identity |
|---|---|
| Compose project | `nettap-packet-expert` |
| Custom model | `nettap-packet-expert:latest` |
| Base model | `qwen3:8b` |
| Ollama context | 16384 tokens |
| Open WebUI workspace context | 8192 tokens; 4096 predicted-token limit |
| Local UI | `127.0.0.1:3001` |
| Production UI | customer HTTPS name, port `8443` by default |
| Administrator login | `admin@nettap.local` with locally generated bootstrap password |
| Persistent volumes | Ollama models; Open WebUI accounts/chats/knowledge |
| Workspace model definition | `openwebui/models/nettap-pcap-expert.json` |
| Active Packet Expert skill | `openwebui/skills/` |
| Custom tools/functions | none installed; `openwebui/settings/extensions.json` |
| Suggestions | six model-specific packet-analysis actions |

Image tags in `.env.example` are bootstrap references. Production uses the platform-specific digests recorded by `scripts/lock-images.sh` in ignored `.env`.

## Initial deployment

macOS:

```bash
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
cd nettap-packet-expert
chmod +x scripts/* tests/*.sh
./scripts/start-macos.sh
```

Windows PowerShell:

```powershell
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
Set-Location .\nettap-packet-expert
.\scripts\start-windows.ps1
```

The startup sequence:

1. validates Docker;
2. creates protected local configuration;
3. generates the WebUI secret and unique bootstrap password;
4. temporarily attaches model-registry egress;
5. pulls images/base model and builds the NetTAP model;
6. removes the bootstrap stack and egress network;
7. starts the loopback-only application.

Activate the administrator according to [AUTHENTICATION.md](AUTHENTICATION.md). Never expose the local profile to another host.

From macOS, WSL, or Git Bash, install or refresh the version-controlled Open
WebUI customizations:

```bash
./scripts/install-openwebui-bundle.sh
```

This idempotently installs the Packet Expert workspace model, the packet-evidence
skill, and its six suggestions. Import and permission the knowledge Markdown
separately so an administrator controls the approved revision and embeddings.
The checked-in profile image uses the local evaluation URL. For production,
replace it with the approved customer HTTPS URL before installing the bundle.

## Production conversion

```bash
./scripts/lock-images.sh --confirm
./scripts/security-scan.sh
./scripts/configure-production.sh \
  --hostname packet-expert.customer.example \
  --certificate /secure/tls.crt \
  --private-key /secure/tls.key
./scripts/production-preflight.sh
./scripts/start-production.sh
./scripts/verify-production-deployment.sh
```

The preflight refuses insufficient CPU/memory/disk, mutable image tags, missing TLS, or incomplete administrator activation. Runtime verification rejects unhealthy services, direct WebUI/Ollama ports, remaining model egress, missing model identity, or failed TLS health.

## Command reference

| Command | Purpose |
|---|---|
| `nettap-packet-expert status` | Show canonical service status |
| `nettap-packet-expert health` | Verify local or production endpoint |
| `nettap-packet-expert stop` | Stop services while preserving volumes |
| `nettap-packet-expert update-model --confirm` | Rebuild through temporary registry egress |
| `nettap-packet-expert lock-images --confirm` | Replace tags with registry digests |
| `nettap-packet-expert scan` | Produce SPDX SBOM and fail on HIGH/CRITICAL CVEs |
| `nettap-packet-expert backup [path] --confirm-stop` | Stop, archive both persistent volumes with checksums, and restart |
| `nettap-packet-expert restore PATH --target-prefix NAME` | Restore only into new volumes |
| `nettap-packet-expert verify-production` | Verify runtime isolation, identity and TLS |
| `nettap-packet-expert certify` | Refuse certification until independent evidence exists |

## Daily operation

1. Run `scripts/healthcheck.sh` and monitor host/Docker/gateway/application logs.
2. Review storage capacity, certificate expiry, backup completion, CVE updates, user access, and security advisories.
3. Keep prompts and evidence out of public logs and tickets.
4. Treat every model answer as advisory and require an authorized operator for changes.

## Backup, restore, and disaster recovery

```bash
./scripts/backup.sh /customer-protected/backup-2026-08-04 --confirm-stop
./scripts/restore.sh /customer-protected/backup-2026-08-04 --target-prefix dr-test
```

Backups contain customer accounts, chats, knowledge, and models. Encrypt them, restrict access, replicate off host, and test restoration at the customer-approved cadence. Restore never attaches volumes or overwrites a deployment. Operations must deliberately validate and connect recovered volumes under change control.

## Updates

Customer production is release-based, not branch-based. Never run an unreviewed `git pull` in place.

1. Review and verify the signed new package.
2. Back up and prove restore.
3. Deploy in a separate directory/volume set.
4. lock digests, scan, initialize and test;
5. complete browser, model, knowledge, data, security and performance acceptance;
6. switch the approved customer endpoint;
7. preserve the old environment for rollback, then retire it under retention policy.

## Accounts, chats, knowledge, and models

All Open WebUI state—including accounts, chats and imported knowledge—is in the Open WebUI volume. Ollama models are in the Ollama volume. Deleting containers does not normally delete named volumes. `docker compose down -v` is destructive and is not a supported routine operation.

The NetTAP Ollama policy and current Qwen3 parameters in `model/Modelfile` load
when the custom model is built. The Open WebUI JSON adds the current extended
packet-analysis prompt, description, safe capability policy, tags, and six
suggestions. Supplemental Markdown knowledge requires a controlled import and
model attachment. Record and compare its hash to `knowledge/manifest.json`; Git
changes do not update existing WebUI data.

The deployment deliberately has no custom Open WebUI tools or legacy functions.
Web search, code execution, image generation, terminal access, direct tool
servers, API keys, and end-user workspace editing are disabled in Compose. If a
future approved release adds any tool, document its code, permissions, outbound
destinations, secrets, and acceptance evidence before enabling it.

## Troubleshooting

| Symptom | Check |
|---|---|
| UI unavailable | `scripts/status.sh`, `scripts/healthcheck.sh`, gateway/WebUI logs, port and DNS |
| Login rejected | Generated file on fresh volume; existing administrator on reused volume |
| Model missing | model-init output, Ollama volume, `scripts/update-model.sh --confirm` |
| Old prompts | Persistent WebUI configuration; edit admin settings instead of deleting data |
| Generic knowledge response | processing status, attachment, permission, selected model |
| Slow inference | CPU/memory allocation, context/concurrency, representative benchmark |
| Production startup refused | generated admin retirement, digest lock, TLS, resource preflight |
| Scan failed | do not deploy; patch/update or approve a documented time-bound exception |

## Sharing and GitHub maintenance

- Publish only reviewed source; exclude `.env`, credentials, keys, backups, generated private reports, and customer data.
- Require pull-request review and passing CI on protected `main`.
- Tag only an exact accepted commit and attach signed source package, checksum, signature, SBOM, notices, release notes, support matrix, and public key.
- Use GitHub private security advisories for vulnerabilities.
- Maintain release/EOL, support, CVE response, key rotation, and backup compatibility policies.

NetTAP-authored source is Apache-2.0 licensed. Commercial distribution additionally requires the exact third-party and branding review in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
