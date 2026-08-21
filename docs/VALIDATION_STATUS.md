# Validation status

## Candidate identity

| Field | Value |
|---|---|
| Suite release | `0.4.0-rc.1` |
| Shared base | `qwen3.5:9b-q4_K_M` |
| Expected base ID | `6488c96fa5fa` |
| Shared NetTAP Network Intelligence Model | `nettap-ai:0.4.0-rc.1` |
| Experience profiles | `nettap-network-visibility`, `nettap-packet-expert` |
| Managed Skills | `nettap-network-visibility`, `nettap-packet-expert` |
| Offline embedding model | `sentence-transformers/all-MiniLM-L6-v2@1110a243fdf4706b3f48f1d95db1a4f5529b4d41` |
| Local launchers | `127.0.0.1:3000`, `127.0.0.1:3001` |
| Shared local UI | `127.0.0.1:3100` |
| Evidence Workspace | `127.0.0.1:3200`; generated independent bearer token |

## Current disposition

The 0.4 suite is an integration release candidate under validation. It is not production-certified, generally available, or approved for commercial appliance distribution.

Static source validation can verify repository structure, Compose isolation, one combined model definition, profile and Skill manifests, base and embedding identity configuration, provisioning API contract and idempotence, exact Skill attachment, model-bundle integrity controls, policy controls, launcher routes, documentation links, and fail-closed release controls. It cannot prove the complete container/model path on advertised target hosts, actual disk use, model response quality for all prompts, application migration success, penetration resistance, legal approval, or support readiness.

## Required evidence for release decision

- Passing static and Compose checks for the exact commit
- Clean macOS runtime report
- Clean Windows runtime report
- One-base/one-combined-model storage measurement
- Existing 0.2 account, chat, and knowledge migration acceptance
- Profile-specific prompt, knowledge, permission, and launcher tests
- Negative RBAC and tool-access tests
- Backup, restore, upgrade, and rollback evidence
- SBOM and accepted vulnerability scan
- Independent penetration-test approval
- Legal, licensing, trademark, and third-party distribution approval
- Support readiness and lifecycle approval
- Signed artifacts and verified provenance
- Authorized release acceptance

Historical release records remain valid only for their exact earlier candidates and do not satisfy the 0.4 gates.

## Honest claim

Until all evidence is complete, the accurate statement is:

> NetTAP Network Intelligence 0.4.0-rc.1 is an integration release candidate for controlled evaluation of one shared NetTAP Network Intelligence Model over one verified Qwen3.5 9B Q4_K_M base, with two distinct Open WebUI experience profiles and automatic retirement of superseded NetTAP container tags after successful provisioning.
