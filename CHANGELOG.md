# Changelog

## 0.3.0-rc.8 consolidated multimodal candidate — 2026-08-07

- Retained one authenticated Open WebUI on loopback port 3100 and one combined managed assistant; ports 3000, 3001 and 3200 remain retired.
- Advanced the single downloadable base to multimodal `qwen3.5:9b` and the NetTAP manifest to `nettap-ai:0.3.0-rc.8` so the same local model handles observability, packet analysis and network diagrams.
- Added signature-validated PNG, JPEG and WebP attachments with explicit visual fact/inference and prompt-injection boundaries.
- Kept PCAP, log and normalized flow records on the deterministic internal evidence path and removed the redundant user-selectable evidence tool binding.
- Updated model identity, memory guidance, provisioning, source pins, tests, architecture and acceptance documentation.
- Corrected the managed offline-RAG probe content to the RC8 marker and added a manifest-to-knowledge consistency check.
- Preserved fail-closed production status pending exact-build macOS and Windows/WSL2 runtime acceptance and commercial release evidence.

## 0.3.0-rc.7 unified application candidate — 2026-08-07

- Replaced separate Network & Visibility and Packet Expert profiles with one combined managed assistant over one `nettap-ai` model.
- Removed public launcher ports 3000/3001 and the separate Evidence Workspace UI/port 3200; one authenticated Open WebUI remains on port 3100 locally.
- Added a reviewed Open WebUI attachment Filter that routes supported files to the internal deterministic evidence service and injects only minimized cited context.
- Combined shared, visibility and packet-analysis knowledge and Skill capability while preserving one Qwen2.5 7B weight download.
- Updated macOS, Windows/WSL2, production, backup, verification, administration and deployment workflows for the single-UI architecture.
- Retained fail-closed production status pending exact-build platform, security, signing and commercial acceptance.

## 0.3.0-rc.5 unified product experience candidate — 2026-08-05

- Added polished, responsive Network & Visibility and Packet Expert welcome pages with clear capability boundaries, guided starts, real application-readiness indication, and direct experience switching.
- Made the same branded pages available through the production TLS gateway at `/visibility/` and `/packet-expert/`.
- Clarified the one-account authentication workflow without adding a second credential store: the welcome pages never accept credentials, and Open WebUI remains authoritative for login, roles, sessions, password changes, and access control.
- Kept one `nettap-ai:0.3.0-rc.5` Ollama model manifest over one Qwen2.5 7B weight set; both managed Workspace Models retain separate prompts, Skills, RAG knowledge, suggestions, and permissions.
- Updated macOS, Windows/WSL2, migration, architecture, authentication, operations, validation, and release-candidate records for RC5.
- Retained fail-closed production and commercial gates pending exact-build runtime, security, signing, legal, support, and commercial acceptance.

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
