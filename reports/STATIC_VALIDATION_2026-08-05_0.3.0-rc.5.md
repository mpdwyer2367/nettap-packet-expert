# Static validation baseline — NetTAP Network Intelligence 0.3.0-rc.5

Recorded date: 2026-08-05

Candidate scope: unified product experience, authentication boundary, one shared
Ollama model, two managed Open WebUI profiles, offline RAG, and Evidence Workspace.

## Source checks

| Check | Result |
|---|---|
| Shell syntax and source policy checks | PASS — `tests/static-checks.sh` |
| Open WebUI provisioning API contract and idempotence | PASS — six provisioning tests |
| Production Compose and Caddy structure | PASS — structural configuration checks |
| Evidence parser, service, and security unit tests | PASS — eight case-service tests |
| Archive safety controls | PASS — three archive-tree tests |
| Model installer and legacy-retirement mock tests | PASS — both regression scripts |
| Branded welcome-page files and route controls | PASS — structure, no credential form, local and TLS routes |

Validation run result: **PASS — 17 Python tests plus source and mock gates.**

The checksum-verifiable model bundle is created only from a clean Git worktree;
its packaging and verification are repeated after the final candidate commit.

Static validation cannot certify container execution, model inference, browser
behavior, macOS or Windows/WSL2 compatibility, penetration resistance, legal
approval, commercial readiness, or production fitness. Those gates remain
explicitly pending in the RC5 acceptance and certification records.
