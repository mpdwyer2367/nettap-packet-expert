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
| Network & Visibility profile | `nettap-network-visibility` |
| Packet Expert profile | `nettap-packet-expert` |
| Source commit | Pending final PR commit |
| Signed artifact | Pending |

## Gate status

| Gate | Status |
|---|---|
| Architecture and migration design | Implemented in source; review pending |
| Static source validation | PASS for available checks; see `STATIC_VALIDATION_2026-08-05_0.3.0-rc.3.md` |
| Provisioning API contract/idempotence | PASS against deterministic mock server |
| Actual pinned Open WebUI and embedding runtime | Pending target host |
| Compose rendering, shell lint, PowerShell parsing | GitHub Actions required for final commit |
| macOS fresh install | Pending target host |
| Windows fresh install | Pending target host |
| 0.2/RC1/RC2 migration | Pending protected test deployment |
| Combined model storage measurement | Pending target host |
| Model behavior and combined capabilities | Test implemented; runtime result pending |
| Profile knowledge, offline RAG, RBAC and tool isolation | Source/API controls implemented; actual runtime acceptance pending |
| Backup, restore and rollback | Tooling implemented; exact-candidate runtime result pending |
| SBOM and vulnerability acceptance | Pending exact image digests |
| Penetration test | Pending independent test |
| Legal and third-party approval | Pending |
| Support readiness | Pending |
| Signed package and provenance | Pending |
| Authorized release acceptance | Pending |

## Decision

The source may enter controlled internal and colleague qualification after CI passes. No production, customer, or commercial approval is granted by this record.
