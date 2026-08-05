# Release acceptance record — NetTAP AI Suite 0.3.0-rc.1

Recorded date: 2026-08-05

Record type: integration-candidate baseline

Release disposition: **EVALUATION ONLY**

Production/customer deployment approval: **NOT GRANTED**

Commercial distribution approval: **NOT GRANTED**

## Identity

| Field | Recorded value |
|---|---|
| Version | `0.3.0-rc.1` |
| Shared base | `qwen2.5:7b-instruct-q4_K_M` |
| Expected base ID | `845dbda0ea48` |
| Network & Visibility | `nettap-network-visibility:0.3.0-rc.1` |
| Packet Expert | `nettap-packet-expert:0.3.0-rc.1` |
| Source commit | Pending final PR commit |
| Signed artifact | Pending |

## Gate status

| Gate | Status |
|---|---|
| Architecture and migration design | Implemented in source; review pending |
| Static source validation | PASS for available source-only checks; see `STATIC_VALIDATION_2026-08-05_0.3.0-rc.1.md` |
| Compose rendering | Pending final recorded run |
| macOS fresh install | Pending target host |
| Windows fresh install | Pending target host |
| 0.2 migration | Pending protected test deployment |
| Shared storage measurement | Pending target host |
| Assistant behavior and routing | Test implemented; runtime result pending |
| Knowledge and RBAC isolation | Pending configured Open WebUI test |
| Backup, restore and rollback | Tooling implemented; exact-candidate runtime result pending |
| SBOM and vulnerability acceptance | Pending exact image digests |
| Penetration test | Pending independent test |
| Legal and third-party approval | Pending |
| Support readiness | Pending |
| Signed package and provenance | Pending |
| Authorized release acceptance | Pending |

## Decision

The repository may enter controlled internal and colleague evaluation after source checks pass. No production, customer, or commercial approval is granted by this record.
