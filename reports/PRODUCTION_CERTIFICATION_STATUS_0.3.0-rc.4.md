# Production certification status — NetTAP Network Intelligence 0.3.0-rc.4

Assessment date: 2026-08-05

Assessment scope: one-model replacement, canonical naming, and documentation

Candidate decision: **SOURCE CANDIDATE FOR CONTROLLED QUALIFICATION**

Production certification decision: **NOT GRANTED**

RC4 defines one shared `nettap-ai:0.3.0-rc.4` model for both managed Open WebUI
profiles. Successful initialization verifies the model and offline retrieval
before removing recognized older NetTAP tags from the containerized Ollama
store. The Qwen base and MiniLM embedding dependency remain because they provide
the shared weights and offline retrieval functions; neither is a second NetTAP
chat model.

Production promotion still requires clean macOS and Windows/WSL2 evidence for
the exact signed package, storage measurement, browser/profile isolation,
restart/backup/restore/rollback, SBOM/CVE acceptance, independent penetration
testing, and legal, support, commercial, signing, and release approvals.

Do not describe this candidate as production ready, production certified,
commercially approved, fully validated, or guaranteed accurate.
