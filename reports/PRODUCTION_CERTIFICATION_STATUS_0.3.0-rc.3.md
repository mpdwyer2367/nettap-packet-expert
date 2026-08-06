# Production certification status — NetTAP Network Intelligence 0.3.0-rc.3

Assessment date: 2026-08-05

Assessment scope: automatic-assistant and offline-RAG source candidate

Candidate decision: **VALID SOURCE CANDIDATE FOR CONTROLLED QUALIFICATION**

Production certification decision: **NOT GRANTED**

## Implemented candidate changes

- One verified Qwen2.5 7B base and one combined `nettap-ai:0.3.0-rc.3` policy model
- One Open WebUI instance with two automatically managed Workspace Models
- Three managed knowledge collections with shared and specialist bindings
- Exact-revision `all-MiniLM-L6-v2` cache created during controlled temporary egress
- Local-only embedding configuration with automatic downloads and remote code disabled at runtime
- Synchronous file parsing/indexing and deterministic offline retrieval proof before launchers start
- Supported Open WebUI API provisioning with fail-closed naming/content conflict handling; no direct database writes
- Preserved access grants when adopting recognized NetTAP RC1/RC2 profiles
- Provisioning fingerprint, embedding integrity metadata, idempotent update path, and recovery controls
- Network & Visibility and Packet Expert launchers selecting distinct managed profiles over the same model weights
- Mock API-contract tests plus target-host verification checks for provisioning state and launcher selection

## Evidence boundary

The exact Open WebUI container, MiniLM files, vector index, Qwen/Ollama runtime, browser experience, macOS path, and Windows path were not runnable in this workspace because Docker was unavailable. The API-contract test proves code behavior against the verified endpoint contract, not the full target runtime. This record does not claim production or commercial readiness.

## Required before candidate promotion

- Passing repository CI for the exact commit, including Compose rendering, ShellCheck, and PowerShell parsing
- Passing macOS and Windows fresh-install reports proving the exact embedding download, offline indexing/retrieval, both profiles, and restart persistence
- Passing protected migration report with accounts, chats, access grants, and customer knowledge preserved
- Measured one-base/one-combined-model and embedding-cache storage
- Browser validation, specialist knowledge isolation, negative RBAC/tool tests, and representative domain evaluation
- Backup, restore, update, and rollback evidence
- SBOM/CVE acceptance and independent penetration-test approval
- Legal, licensing, trademark, privacy, support, signing, and authorized release approvals

## Authorized statement

“NetTAP Network Intelligence 0.3.0-rc.3 is a valid source candidate for controlled qualification of automatic Open WebUI assistant provisioning and pinned offline RAG over one shared NetTAP Network Intelligence Model.”

Do not use “production ready,” “production certified,” “commercially approved,” “fully validated,” “100 percent accurate,” or “100 percent secure” for this candidate.
