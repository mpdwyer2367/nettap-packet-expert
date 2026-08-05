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
- Backup/restore rehearsal for this exact commit: pending.
- Immutable image locks and SBOM/CVE review: pending.
- Independent penetration, legal, support, and release approvals: pending.

Until every release gate passes, production/customer deployment and commercial
distribution remain prohibited.
