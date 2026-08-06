# Production certification status — 0.3.0-rc.1

## Decision

Production certification decision: **NOT GRANTED**.

This candidate is a **VALID PRODUCTION CANDIDATE** only for controlled,
non-production qualification of the documented single-node architecture. The
Qwen3 model refresh, Open WebUI custom model, packet skill, six suggestions,
knowledge manifest, and revised deployment instructions require fresh runtime
evidence. Earlier 0.2.0-rc.1 reports do not attest this candidate.

## Required evidence

- Fresh macOS physical-host deployment and model-behavior report: pending.
- Fresh Windows physical-host deployment and model-behavior report: pending.
- Backup/restore rehearsal: **PASS** on a physical macOS host for source
  revision `aff27eee758fc3cce8726005c2527dcca797e91d`; see the
  [recovery report](BACKUP_RESTORE_VALIDATION_2026-08-05.md). Physical Windows
  recovery evidence remains pending.
- Immutable image locks and SBOM/CVE review: pending.
- Independent penetration, legal, support, and release approvals: pending.

Until every release gate passes, production/customer deployment and commercial
distribution remain prohibited.
