# Changelog

## Unreleased — evidence citation integrity

- Added an evaluation-only Qwen3.5 9B candidate lane that preserves RC4, generates the candidate from the shared policy, verifies the published base identity, creates non-default test profiles, and compares the same fourteen evidence-boundary behaviors.
- Added evidence database schema v2 with additive migration from schema v1.
- Added typed citations for evidence manifests, exact normalized observations, and SHA-256-bound deterministic analysis artifacts.
- Added an audited, case-scoped read-only citation resolver and one-click citation inspection in the Evidence Workspace.
- Added negative cross-case citation tests and documented the citation trust boundary and remaining release gates.

## 0.3.0-rc.4 one-model replacement and canonical naming candidate — 2026-08-05

- Advanced the combined model policy to `nettap-ai:0.3.0-rc.4` and changed its embedded identity to **NetTAP Network Intelligence Model**.
- Added automatic post-verification retirement of superseded NetTAP container tags so a successful deployment leaves one current NetTAP model tag for both Open WebUI experiences.
- Retained dry-run-first model retirement for macOS/Linux/WSL2 and Windows PowerShell, with explicit opt-in for a separately reviewed native Ollama store.
- Clarified that both product experiences are Open WebUI profiles over one downloaded Qwen weight set and one NetTAP model manifest, not separate LLM downloads.
- Adopted **NetTAP Network Intelligence** as the canonical product name, standardized the two experience and Evidence Workspace display names, and documented the unchanged legacy compatibility identifiers.
- Set the browser-visible Open WebUI application name to **NetTAP Network Intelligence** through the supported `WEBUI_NAME` configuration.
- Added updated application and model-replacement architecture visuals.
- Added an authenticated, offline-first Evidence Workspace with persistent cases, source hashing, provenance, quality warnings and audit events.
- Added deterministic classic-PCAP metadata parsing and normalized PCAP, syslog, IPFIX, NetFlow, sFlow, cloud-flow and JSON/JSONL ingestion without sending raw evidence to Ollama.
- Added evidence-bound summaries, observations and explicitly qualified hypotheses, plus Markdown reports and minimized `nettap-evidence-context/v1` exports.
- Added a dedicated evidence volume, generated API token, loopback local endpoint, TLS-gateway production-candidate route, backup-v3 coverage and non-overwriting restore support.
- Added service-level functional/security tests and extended deployment validation. This remains an evaluation candidate and requires target-host acceptance before release promotion.

## 0.3.0-rc.3 automatic assistants and offline RAG candidate — 2026-08-05

- Added fail-closed, idempotent provisioning of two Open WebUI Workspace Models and three managed knowledge collections through pinned Open WebUI v0.11.0 APIs.
- Added controlled initialization of `all-MiniLM-L6-v2` at exact revision `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`, followed by local-only embedding and retrieval configuration.
- Added a deterministic offline retrieval proof that must pass before launcher pages start.
- Changed launchers to select the managed Network & Visibility and Packet Expert profiles, both backed by one `nettap-ai:0.3.0-rc.3` Ollama model.
- Added API-contract/idempotence tests, provisioning state evidence, target-host verification gates, migration guidance, and fail-closed recovery.
- Retained production and commercial approval gates pending exact-build macOS and Windows runtime evidence and the existing security, legal, support, signing, and acceptance records.

## 0.3.0-rc.2 combined NetTAP AI model candidate — 2026-08-05

- Replaced two NetTAP Ollama model tags with one combined `nettap-ai:0.3.0-rc.2` model containing Network & Visibility, Packet Expert, and unified cross-domain capabilities.
- Retained two thin experience profiles with separate names, specialist knowledge, suggestions, launcher ports, permissions, and future tool allowlists over the same model.
- Updated deployment, migration, backup, storage, behavioral, runtime, documentation, and release controls for the one-model architecture.
- Kept retired 0.2 and 0.3-rc.1 model tags non-destructively for rollback; they are no longer selected by rc.2.
- Kept production and commercial approval fail-closed pending exact-build target-host, security, legal, support, signing, and acceptance evidence.

## 0.3.0-rc.1 unified NetTAP Network Intelligence candidate — 2026-08-05

- Added Network & Visibility and retained Packet Expert as separate assistant policies over one Qwen2.5 7B base.
- Consolidated both assistants into one Ollama service, one model volume, one Open WebUI, one account/chat database, and one administration lifecycle.
- Added stateless branded launchers on local ports 3000 and 3001 with a shared Open WebUI on port 3100.
- Added assistant manifests, isolated knowledge sources, a unified `nettap-ai` CLI, migration and rollback controls, and expanded behavioral/isolation tests.
- Preserved the Compose project and volume identity for controlled migration from 0.2.0-rc.1.
- Kept production and commercial approval fail-closed pending exact-build target-host, security, legal, support, signing, and acceptance evidence.

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
