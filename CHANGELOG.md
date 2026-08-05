# Changelog

## 0.3.0-rc.1

- Updated the base LLM from Qwen2.5 7B to the current `qwen3:8b` manifest.
- Synchronized the live principal-level Packet Expert Ollama and Open WebUI prompts.
- Added the version-controlled Open WebUI workspace model and Packet Expert skill.
- Replaced four generic starters with six packet-specialist suggestions.
- Added a checksum knowledge manifest and a zero-custom-tools inventory.
- Updated and cross-checked macOS and Windows deployment instructions.
- Reset production and commercial acceptance to pending for the changed candidate.

## 0.2.0-rc.1 production-candidate validation update — 2026-08-04

- Added GitHub Actions shell lint and rendering of local, production and bootstrap Compose profiles.
- Bound production runtime verification to approved image references, least-privilege controls, exact gateway exposure, HSTS and locked base/custom model identities.
- Added release/model/image/source identity to backup manifests and a same-release restore gate.
- Added signed artifact provenance containing the release, commit, tree and SHA-256 digest.
- Classified the exact supported architecture as a valid candidate for controlled qualification while retaining fail-closed production/commercial certification gates.

## 0.2.0-rc.1

- Added separate local, bootstrap-egress, and TLS production Compose profiles.
- Replaced the shared bootstrap password with a locally generated credential and fail-closed production activation.
- Added image digest locking, offline runtime, hardened WebUI settings, metadata audit logging, resource limits, capability reduction, and log rotation.
- Added consistent stop/archive/restart backup, checksum verification, non-overwriting restore, health/preflight/runtime verification, SBOM/CVE scanning, signed packaging, and fail-closed certification gates.
- Expanded model policy and tests for prompt injection, human approval, data minimization, tenancy, and forensic provenance.
- Added production architecture, threat model, customer guide, commercial gates, support boundary, and revised acceptance documentation.

Known limitations: single node; local accounts; no HA, SSO/MFA, OVA, licensing enforcement, native packet/telemetry ingestion, automated remediation, centralized immutable audit store, or production certification.
