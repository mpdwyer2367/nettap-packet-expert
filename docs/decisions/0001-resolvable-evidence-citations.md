# ADR 0001: Resolvable evidence citations

- Status: accepted for the RC4 evaluation workspace
- Date: 2026-08-05

## Context

The initial Evidence Workspace attached whole-evidence UUIDs to findings. That preserved
source identity but did not let a reviewer trace a finding to the exact normalized record
or verify the deterministic result artifact.

## Decision

Every generated finding carries typed citations:

- `normalized_observation` identifies the case-scoped observation UUID, evidence UUID,
  source record sequence, and timestamp.
- `evidence_manifest` identifies the evidence UUID, original SHA-256, and cited manifest field.
- `analysis_artifact` identifies the analysis UUID, JSON result path, and SHA-256 of the
  canonical deterministic summary-and-findings payload.

The API resolves normalized observations only when both case ID and observation ID match.
It resolves analysis artifacts only when both case ID and analysis ID match. Successful
resolution is audited. The observation endpoint returns normalized metadata only and never
returns retained raw evidence. A bounded set of exact observation selectors is stored for a
finding; the retrievable hashed analysis artifact remains the integrity reference for aggregate results.

## Consequences

- Reviewers can inspect the exact normalized record behind a UI citation.
- Cross-case object references fail with `404` rather than revealing object existence.
- Existing schema-v1 databases require an additive, in-place migration to schema v2.
- The analysis hash provides integrity detection, not a signature or tamper-evident audit chain.
- Per-user authorization is still required before production use.
