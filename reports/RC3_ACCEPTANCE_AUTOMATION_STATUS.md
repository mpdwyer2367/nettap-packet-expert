# RC3 acceptance automation status

Recorded date: 2026-08-05

Release: `0.3.0-rc.3`

Disposition: **IMPLEMENTED FOR TARGET-HOST EXECUTION; NOT YET EXECUTED ON macOS AND WINDOWS/WSL2**

## Implemented

- Exact prompt and knowledge source checksums, verified before provisioning.
- Exact-revision embedding cache, controlled installation egress, offline runtime, knowledge ingestion and deterministic retrieval proof.
- Automatic creation and reconciliation of both Open WebUI assistants over one `nettap-ai` model store.
- Synthetic normalized packet-derived, security-log and IPFIX fixtures plus evidence-bound model evaluation.
- Clean-package runner with unique empty Docker volumes and generated administrator credential workflow.
- Exact archive-to-Git-tree verification and signed package/provenance verification.
- Platform-specific immutable image locking, SPDX SBOM generation and HIGH/CRITICAL vulnerability gate.
- Restart, backup/non-overwriting restore and deliberately failed-update recovery checks.
- macOS/Windows summary comparison proving both tests used the identical package.

## Evidence still required

- Passing clean-package execution on a supported macOS host.
- Passing clean-package execution on a Windows host with WSL2 and Docker Desktop.
- Passing comparison of the two platform summaries.
- Cross-version rollback using the prior signed package and protected pre-upgrade backup.
- Independent penetration-test disposition.
- Legal, third-party, branding, support, commercial and authorized release approvals.
- Signed final release artifacts and completed release-acceptance record.

This status is an engineering implementation record. It does not certify a runtime that was not executed and does not grant production or commercial approval.
