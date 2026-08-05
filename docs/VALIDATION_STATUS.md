# Validation status

## Candidate identity

| Field | Value |
|---|---|
| Suite release | `0.3.0-rc.2` |
| Shared base | `qwen2.5:7b-instruct-q4_K_M` |
| Expected base ID | `845dbda0ea48` |
| Combined NetTAP AI model | `nettap-ai:0.3.0-rc.2` |
| Experience profiles | `nettap-network-visibility`, `nettap-packet-expert` |
| Local launchers | `127.0.0.1:3000`, `127.0.0.1:3001` |
| Shared local UI | `127.0.0.1:3100` |

## Current disposition

The 0.3 suite is an integration release candidate under validation. It is not production-certified, generally available, or approved for commercial appliance distribution.

Static source validation can verify repository structure, Compose isolation, one combined model definition, profile manifests, base identity configuration, policy controls, launcher routes, documentation links, and fail-closed release controls. It cannot prove target-host operation, actual disk use, model response quality for all prompts, application migration success, penetration resistance, legal approval, or support readiness.

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

The historical [0.2.0-rc.1 release record](../reports/RELEASE_ACCEPTANCE_0.2.0-rc.1.md) remains valid only for that earlier candidate and does not satisfy the 0.3 gates.

## Honest claim

Until all evidence is complete, the accurate statement is:

> NetTAP AI Suite 0.3.0-rc.2 is an integration release candidate for controlled evaluation of one combined NetTAP AI model over one Qwen2.5 7B base, with two distinct Open WebUI experience profiles.
