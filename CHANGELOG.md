# Changelog

## 0.2.0-rc.1

- Added separate local, bootstrap-egress, and TLS production Compose profiles.
- Replaced the shared bootstrap password with a locally generated credential and fail-closed production activation.
- Added image digest locking, offline runtime, hardened WebUI settings, metadata audit logging, resource limits, capability reduction, and log rotation.
- Added consistent stop/archive/restart backup, checksum verification, non-overwriting restore, health/preflight/runtime verification, SBOM/CVE scanning, signed packaging, and fail-closed certification gates.
- Expanded model policy and tests for prompt injection, human approval, data minimization, tenancy, and forensic provenance.
- Added production architecture, threat model, customer guide, commercial gates, support boundary, and revised acceptance documentation.

Known limitations: single node; local accounts; no HA, SSO/MFA, OVA, licensing enforcement, native packet/telemetry ingestion, automated remediation, centralized immutable audit store, or production certification.
