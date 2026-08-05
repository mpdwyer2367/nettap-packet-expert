# Release acceptance record — NetTAP AI Suite 0.3.0-rc.3

Recorded date: 2026-08-05

Record type: automatic-assistant and offline-RAG candidate baseline

Release disposition: **EVALUATION ONLY**

Production/customer deployment approval: **NOT GRANTED**

Commercial distribution approval: **NOT GRANTED**

## Identity

| Field | Recorded value |
|---|---|
| Version | `0.3.0-rc.3` |
| Shared base | `qwen2.5:7b-instruct-q4_K_M` |
| Expected base ID | `845dbda0ea48` |
| Combined model | `nettap-ai:0.3.0-rc.3` |
| Offline embedding | `sentence-transformers/all-MiniLM-L6-v2` |
| Embedding revision | `1110a243fdf4706b3f48f1d95db1a4f5529b4d41` |
| Prompt/Skill/knowledge identities | `provisioning/knowledge-sources.sha256` |
| Native model installers | macOS/Linux/WSL Bash and Windows PowerShell |
| Download bundle | `nettap-ai-model-0.3.0-rc.3.tar.gz` source bundle; weights intentionally excluded |
| Network & Visibility profile | `nettap-network-visibility` |
| Packet Expert profile | `nettap-packet-expert` |
| Source commit | Pending final PR commit |
| Source tree | Pending final PR tree |
| Source package SHA-256 | Pending signed package |
| Artifact/provenance signatures | Pending authorized release signer |

## Gate status

| Gate | Status |
|---|---|
| Architecture and migration design | Implemented in source; review pending |
| Static source validation | PASS for available checks; see `STATIC_VALIDATION_2026-08-05_0.3.0-rc.3.md` |
| Provisioning API contract/idempotence | PASS against deterministic mock server |
| Native combined-model creation | PASS in isolated Linux x86_64 Ollama `0.32.5`; see `NATIVE_MODEL_CREATION_2026-08-05_0.3.0-rc.3.md` |
| Native CPU model load | PASS; token generation remained environment-limited and is not accepted as target-host inference evidence |
| Managed Skills and exact profile attachment | PASS against deterministic mock server; actual Open WebUI runtime pending |
| Combined model source bundle | Build and verification implemented; GitHub CI and signed release artifact pending |
| Actual pinned Open WebUI and embedding runtime | Pending target host |
| Compose rendering, shell lint, PowerShell parsing | GitHub Actions required for final commit |
| macOS fresh install | Pending target host |
| Windows fresh install | Pending target host |
| 0.2/RC1/RC2 migration | Pending protected test deployment |
| Combined model storage measurement | Pending target host |
| Model behavior and combined capabilities | Test implemented; runtime result pending |
| Profile knowledge, offline RAG, RBAC and tool isolation | Source/API controls implemented; actual runtime acceptance pending |
| Normalized packet/log/IPFIX cases | Test fixtures and evaluation implemented; exact-candidate runtime result pending |
| Backup, restore, restart and failed-update recovery | Tooling implemented; exact-candidate runtime result pending |
| Cross-version rollback | Pending prior signed package and protected pre-upgrade backup exercise |
| SBOM and vulnerability acceptance | Pending exact image digests |
| Penetration test | Pending independent test |
| Legal and third-party approval | Pending |
| Support readiness | Pending |
| Signed package and provenance | Pending |
| Authorized release acceptance | Pending |

## Decision

The source may enter controlled internal and colleague qualification after CI passes. No production, customer, or commercial approval is granted by this record.

The authoritative platform procedure is `tests/clean-package-acceptance.sh`. macOS and Windows/WSL2 must use the identical signed archive, commit, tree and SHA-256, and their summaries must pass `tests/compare-platform-acceptance.sh`. Empty or self-authored placeholder approval records do not satisfy a gate.
