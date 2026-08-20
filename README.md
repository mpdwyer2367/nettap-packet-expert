# NetTAP Network Intelligence

NetTAP Network Intelligence is a private, customer-isolated network visibility and forensic operations platform. It runs one shared **NetTAP Network Intelligence Model** with two specialized user experiences:

- **NetTAP Network Intelligence — Network & Visibility** for architecture, device planning, TAP/SPAN/NPB deployment, telemetry acquisition, and visibility operations.
- **NetTAP Network Intelligence — Packet Expert** for authorized packet evidence, capture planning, performance investigation, cyber visibility, and forensic analysis.

The two experiences select the same technical Ollama model tag, `nettap-ai:0.4.0-rc.1`, built once from the verified `qwen3.5:9b-q4_K_M` base. A fresh appliance downloads one 6.6 GB Qwen weight set and creates one NetTAP model manifest over those shared blobs. Thin Open WebUI Workspace Model profiles retain separate names, specialist knowledge, suggested starting points, and future tool allowlists without downloading or duplicating a second 9B model. The shared model also supports unified cross-domain workflows with a configured 16,384-token context window. One Open WebUI instance provides one account, chat history, administration, audit, backup, and update surface.

The repository contains the combined model definition, both experience Skills, reviewed RAG knowledge, automatic provisioning, and the evaluation **NetTAP Network Intelligence — Evidence Workspace** for uploaded PCAP metadata, normalized logs and flow records. It does **not** contain separately fine-tuned weights, customer telemetry, packet captures, credentials, or a live NetTAP connector. See the [combined model card](model/MODEL_CARD.md), [Evidence Workspace guide](docs/EVIDENCE_CASE_SERVICE.md), and [naming conventions](docs/NAMING_CONVENTIONS.md).

## Release status

`0.4.0-rc.1` promotes Qwen3.5 9B Q4_K_M as the default foundation for both NetTAP profiles. It is a migration and integration release candidate, not a production-certified or commercially approved appliance. The exact commit still requires passing macOS and Windows/WSL2 runtime evidence, behavior and profile-isolation tests, storage measurement, SBOM/CVE acceptance, independent penetration testing, legal/licensing approval, support readiness, signature verification, and authorized release acceptance. See the [promotion decision](docs/QWEN35_PROMOTION.md).

The completed `0.2.0-rc.1` Packet Expert evidence record remains historical evidence for that earlier single-assistant candidate. It does not certify the current platform candidate. See [validation status](docs/VALIDATION_STATUS.md).

## Architecture

```mermaid
flowchart TB
    U["Authorized user"] --> L["Branded launchers"]
    L --> W["One Open WebUI"]
    W --> V["Network & Visibility profile"]
    W --> P["Packet Expert profile"]
    V --> N["One nettap-ai:0.4.0-rc.1 model"]
    P --> N
    N --> Q["One pinned Qwen3.5 9B base"]
    U --> E["Evidence Workspace"]
    E --> D["Deterministic case analysis"]
    D --> X["Minimized evidence context"]
    X -. "authorized transfer" .-> W
```

The local launchers are stateless pages. The shared browser application is named **NetTAP Network Intelligence** through Open WebUI's supported `WEBUI_NAME` setting. Each launcher selects its automatically managed Open WebUI Workspace Model through documented `model` and `q` URL parameters. Both Workspace Models use the same combined Ollama model, while retaining separate prompts, suggestions, and specialist knowledge bindings. Accounts, chats, model weights, and administration remain shared.

## Download or create the shared model

The repository is the downloadable source of truth for the NetTAP Network Intelligence Model under technical tag `nettap-ai:0.4.0-rc.1`. It includes both experience capabilities in one Ollama policy:

- Network & Visibility: architecture, TAP/SPAN/NPB design, routing and switching context, telemetry acquisition, deployment and troubleshooting.
- Packet Expert: authorized capture planning, evidence quality, PCAP-derived analysis, performance, cyber visibility and forensics.
- Unified mode: moves safely from visibility design to evidence collection and investigation.

For an existing native Ollama installation on macOS, Linux or WSL/Git Bash:

```bash
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
cd nettap-packet-expert
./scripts/install-model-native.sh --confirm-download
ollama run nettap-ai:0.4.0-rc.1
```

For native Windows PowerShell:

```powershell
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
Set-Location .\nettap-packet-expert
.\scripts\install-model-native.ps1 -ConfirmDownload
ollama run nettap-ai:0.4.0-rc.1
```

This saves the combined model in that machine's active Ollama store and, only after identity verification succeeds, removes recognized superseded native NetTAP tags. It preserves the Qwen base and non-NetTAP models. The native-only path does not install Open WebUI, assistant profiles, RAG or launchers; use the full deployment below for both finished product experiences.

The GitHub repository deliberately does not duplicate the multi-gigabyte Qwen base weights. A release manager can produce a checksum-verifiable bundle of the model definition, both Skills, knowledge and installers with `./scripts/package-model-bundle.sh`. The bundle recreates the model through Ollama after checking the pinned base ID. See the [model card](model/MODEL_CARD.md) for the exact inclusions and limits.

Read [the architecture](docs/ARCHITECTURE.md), [migration procedure](docs/MIGRATION.md), and [assistant customization guide](docs/ASSISTANT_CUSTOMIZATION.md) before upgrading an existing deployment. Platform instructions are available for [macOS](docs/MACOS_DEPLOYMENT.md), [Windows](docs/WINDOWS_DEPLOYMENT.md), and [Linux](docs/LINUX_DEPLOYMENT.md).

## Local addresses

| Address | Purpose |
|---|---|
| <http://127.0.0.1:3000> | Network & Visibility starting page |
| <http://127.0.0.1:3001> | Packet Expert starting page |
| <http://127.0.0.1:3100> | Shared Open WebUI and model selector |
| <http://127.0.0.1:3200> | Local Evidence Workspace for cases and uploaded evidence |

The two launchers do not run separate Open WebUI databases or duplicate model weights. The Evidence Workspace has a separate local data volume and generated bearer token so raw evidence is not placed in Open WebUI or Ollama storage.

## Requirements

- Docker Desktop and Docker Compose v2
- macOS on Apple Silicon or Intel, or Windows with WSL 2 and Linux containers
- At least 20 GiB free disk for local evaluation
- Recommended local allocation: 8 CPUs and 24 GiB host memory, with at least 16 GiB available to Docker
- More memory improves context length and concurrent use

The supplied containerized Ollama profile is CPU-compatible. It does not claim Apple Metal or Windows GPU acceleration.

## New installation

### macOS

```bash
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
cd nettap-packet-expert
chmod +x scripts/* tests/*.sh
./scripts/start-macos.sh
```

### Windows PowerShell

Run Docker Desktop with WSL 2 and Linux containers:

```powershell
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
Set-Location .\nettap-packet-expert
.\scripts\start-windows.ps1
```

### Linux

```bash
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
cd nettap-packet-expert
chmod +x scripts/* tests/*.sh
./scripts/start-linux.sh
```

Startup uses temporary registry egress to retrieve the verified base model, pinned Open WebUI image, and the exact offline embedding-model revision. It then removes registry egress, starts Open WebUI in offline mode, creates three managed knowledge collections, installs two managed Skills, proves retrieval using a deterministic marker, creates both managed Workspace Models, attaches the matching Skill to each, and only then starts the launcher pages. Any failed identity, cache, ingestion, retrieval, Skill, or profile check stops installation.

Startup also generates `.evidence-api-token` and starts the loopback-only Evidence Workspace. Use it to create a case, upload authorized evidence, review provenance and quality, run deterministic analysis, inspect case-scoped citations to exact normalized observations, and export the minimized case context. Raw evidence is never automatically submitted to the model. The service remains an evaluation feature and does not change the `0.4.0-rc.1` production-certification status.

The startup script also generates a unique bootstrap password and prints the protected local file containing it. Sign in as `admin@nettap.local`, change the password immediately, verify the generated password no longer works, and complete administrator finalization. There is no shared or committed default password.

A populated Open WebUI volume retains its existing accounts and passwords; startup does not reset them.

## Upgrade from Packet Expert 0.2

Do not begin by deleting containers or volumes. Follow [MIGRATION.md](docs/MIGRATION.md) to:

1. Inventory and back up the old deployment while using the old release.
2. Protect the old `.env` and record its source commit.
3. Apply the reviewed platform candidate.
4. Build one shared NetTAP Network Intelligence Model from the verified base.
5. Preserve existing Open WebUI accounts, chats, and Packet Expert knowledge.
6. Add the isolated Network & Visibility knowledge collection.
7. Validate both experience profiles, the combined model, launchers, storage, backup, restore, and rollback.

Never merge Open WebUI SQLite files or mount one SQLite volume into multiple running Open WebUI containers.

## Administration

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

`0.4.0-rc.1` defaults `RETIRE_LEGACY_NETTAP_MODELS=true`. After the new model identity,
both Open WebUI profiles, and offline retrieval are verified, initialization
removes only older recognized NetTAP tags from the appliance Ollama store. The
dry-run command audits the result. The current model, Qwen base, non-NetTAP
models, accounts, chats, knowledge, evidence, and Docker volumes remain. Add
`--include-native` only when a separate host-native store has been reviewed.

The old `scripts/nettap-packet-expert` entry point remains as a compatibility wrapper for the 0.3 migration. See [administration](docs/ADMINISTRATION.md), [backup and restore](docs/COMPLETE_OPERATIONS_MANUAL.md), and [authentication](docs/AUTHENTICATION.md).

### Qwen3.5 9B promotion

Qwen3.5 9B Q4_K_M is now the shared release-candidate base. Both managed profiles and direct unified use resolve to `nettap-ai:0.4.0-rc.1`; there is no parallel candidate profile or second NetTAP weight download. The change preserves NetTAP prompts, Skills, RAG sources and evidence controls. Upstream multimodal or tool capabilities are not automatically enabled in this application. See [the promotion record](docs/QWEN35_PROMOTION.md).

## Knowledge and customizations

| Experience | Runtime model policy | Managed Skill | Knowledge source |
|---|---|---|---|
| Shared Network Intelligence Model | [nettap-ai.Modelfile](model/nettap-ai.Modelfile) | Combined policy in model | [Shared Network Intelligence knowledge](knowledge/NetTAP_AI_Knowledge.md) |
| Network & Visibility experience | Same `nettap-ai` model | [Network & Visibility Skill](skills/nettap-network-visibility/SKILL.md) | [Network & Visibility knowledge](knowledge/NetTAP_Network_Visibility_Knowledge.md) |
| Packet Expert experience | Same `nettap-ai` model | [Packet Expert Skill](skills/nettap-packet-expert/SKILL.md) | [Packet Expert knowledge](knowledge/NetTAP_Packet_Expert_Knowledge.md) |

The [ingestion and analysis guidance](knowledge/NetTAP_Ingestion_Analysis_Guidance.md) is shared by both profiles. It defines accurate handling for PCAP-derived evidence, logs, flow telemetry, cloud flow records, decryption, provenance, correlation, and evidence-bounded security conclusions.

Critical evidence and safety rules are built into the combined Ollama model definition. `0.4.0-rc.1` reconciles reviewed Git sources into restricted managed Open WebUI collections through supported application APIs; it never writes Open WebUI database tables directly. Shared knowledge is attached to both profiles and each specialist collection only to its matching profile. Source changes produce a new provisioning fingerprint and require a successful administrator-authenticated reconciliation before the launchers are enabled.

See [assistant customization](docs/ASSISTANT_CUSTOMIZATION.md), [knowledge management](docs/KNOWLEDGE_MANAGEMENT.md), and [tool security](docs/TOOL_SECURITY.md).

## Validation

Source validation:

```bash
./tests/static-checks.sh
python3 -m unittest -v tests/test_case_service.py
```

Runtime validation after deployment:

```bash
./tests/model-behavior-eval.sh
./tests/normalized-ingestion-eval.sh
./tests/model-storage-sharing.sh
./tests/backup-restore-e2e.sh
./tests/failed-update-rollback-e2e.sh
```

On a supported macOS host:

```bash
./tests/macos-e2e.sh
```

Release acceptance must start from the signed source package rather than a working checkout. Run the following command once on macOS and once inside Windows/WSL2, using the same archive, checksum, provenance, signatures, and public key:

```bash
./tests/clean-package-acceptance.sh \
  --archive /approved/nettap-ai-suite-0.4.0-rc.1-source.tar.gz \
  --evidence-dir /protected/nettap-040rc1-acceptance \
  --public-key /approved/cosign.pub
```

The clean-package test creates an isolated Compose project with empty volumes, verifies the package against its exact Git tree and signature, installs the candidate, requires administrator password replacement, verifies ports 3000/3001/3100/3200, exercises automatic offline RAG, both assistants, and authenticated evidence ingestion, executes all fourteen behavior cases plus normalized packet/log/IPFIX examples, measures shared model storage, and tests restart, backup/restore, failed-update recovery, SBOM, and the vulnerability policy. Compare the two resulting summaries with `./tests/compare-platform-acceptance.sh`. See the [0.4.0-rc.1 acceptance plan](docs/0.4.0_RC1_ACCEPTANCE_PLAN.md).

The tests verify model identity, provisioning API behavior and idempotence, exact embedding revision metadata, offline retrieval proof, managed profile selection, combined capabilities, evidence boundaries, shared runtime, and recovery controls. They do not prove factual accuracy for every prompt or replace target-host, independent security, and customer acceptance.

## Production profile

Use a customer-approved DNS name and certificate:

```bash
./scripts/lock-images.sh --confirm
./scripts/security-scan.sh
./scripts/configure-production.sh \
  --hostname nettap-ai.customer.example \
  --certificate /secure/path/tls.crt \
  --private-key /secure/path/tls.key
./scripts/production-preflight.sh
./scripts/start-production.sh
./scripts/verify-production-deployment.sh
```

Production assistant links are:

- `https://nettap-ai.customer.example:8443/visibility`
- `https://nettap-ai.customer.example:8443/packet-expert`
- `https://nettap-ai.customer.example:8443/evidence/` (separate generated bearer token)

The TLS gateway is the only production browser entry point. Ollama and Open WebUI have no direct production host ports. Each customer or security boundary requires a separate instance.

## Product boundaries

- No live traffic or telemetry is available unless a separately approved connector supplies current evidence.
- The LLM is not an NPB, capture engine, flow collector, SIEM, IDS/IPS, NDR, enterprise case-management replacement, or autonomous controller. The separate Evidence Workspace provides bounded local case analysis only.
- Configuration and forensic conclusions require authorized human review.
- Tools are disabled by default and require a separate security and release decision.
- Never commit `.env`, TLS private keys, bootstrap credentials, customer evidence, backups, private reports, or model weights.

## Release and license

The certification command is fail-closed and cannot manufacture external evidence:

```bash
./scripts/certify-production.sh
COSIGN_KEY=/secure/release.key ./scripts/package-release.sh
./scripts/verify-release.sh dist/nettap-ai-suite-0.4.0-rc.1-source.tar.gz /path/to/cosign.pub
```

NetTAP-authored source, configuration, and documentation are licensed under the [Apache License 2.0](LICENSE), copyright 2026 NetTAP Technology Limited. The license does not relicense container images, base-model artifacts, or other dependencies and does not grant trademark rights. Review [third-party notices](THIRD_PARTY_NOTICES.md) before distribution.
