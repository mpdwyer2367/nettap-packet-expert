# Production certification status — NetTAP AI Suite 0.3.0-rc.1

Assessment date: 2026-08-05

Assessment scope: integration source candidate

Candidate decision: **SOURCE QUALIFICATION IN PROGRESS**

Production certification decision: **NOT GRANTED**

## Implemented candidate changes

- One Ollama service and persistent model volume
- One Qwen2.5 7B base-model identity gate
- Separate Network & Visibility and Packet Expert model policies
- One Open WebUI account, chat, knowledge, audit, backup, and administration surface
- Stateless loopback launchers on ports 3000 and 3001
- Shared Open WebUI on port 3100
- Separate assistant manifests and knowledge sources
- Unified `nettap-ai` administration command with legacy compatibility wrapper
- Controlled environment migration from 0.2.0-rc.1
- Expanded source, behavior, routing, launcher, recovery, and release gates

## Evidence boundary

This record does not claim a completed macOS or Windows runtime deployment, actual disk-space reduction, Workspace Model import, knowledge migration, penetration test, legal approval, support readiness, or signed commercial release. Those results must be produced against the exact final commit and artifact.

The prior Packet Expert 0.2.0-rc.1 production-candidate record is historical evidence only. Changing the runtime topology and adding a second assistant requires new qualification.

## Required before candidate promotion

- Passing repository CI and clean source tree
- Passing macOS and Windows fresh-install reports
- Passing 0.2-to-0.3 migration report with accounts, chats, and knowledge preserved
- Measured single-base/two-manifest model storage
- Browser validation of both launchers and model switching
- Assistant-specific prompt and knowledge-isolation acceptance
- Negative RBAC and tool-access tests
- Backup, restore, update, and rollback evidence
- SBOM/CVE acceptance and independent penetration-test approval
- Legal, licensing, trademark, privacy, support, signing, and release approvals

## Authorized statement

“NetTAP AI Suite 0.3.0-rc.1 is an integration release candidate under controlled source and target-host qualification.”

Do not use “production ready,” “production certified,” “commercially approved,” “fully validated,” “100 percent accurate,” or “100 percent secure” for this candidate.
