# Production certification status — NetTAP Network Intelligence 0.3.0-rc.5

Assessment date: 2026-08-05

Assessment scope: unified product experience, authentication boundary, one-model replacement, and documentation

Candidate decision: **SOURCE CANDIDATE FOR CONTROLLED QUALIFICATION**

Production certification decision: **NOT GRANTED**

RC5 defines one shared `nettap-ai:0.3.0-rc.5` model for both managed Open WebUI
profiles. Successful initialization verifies the model and offline retrieval
before removing recognized older NetTAP tags from the containerized Ollama
store. The Qwen base and MiniLM embedding dependency remain because they provide
the shared weights and offline retrieval functions; neither is a second NetTAP
chat model.

RC5 also supplies consistent local and production welcome pages. These pages
show experience purpose, guided starts, authentication guidance, and application
readiness, but never receive credentials. Open WebUI remains authoritative for
identity, role, session, password, and model access. This boundary requires
clean-browser and authenticated-session acceptance on both supported host paths.

Production promotion still requires clean macOS and Windows/WSL2 evidence for
the exact signed package, storage measurement, browser/profile isolation,
restart/backup/restore/rollback, SBOM/CVE acceptance, independent penetration
testing, and legal, support, commercial, signing, and release approvals.

Do not describe this candidate as production ready, production certified,
commercially approved, fully validated, or guaranteed accurate.
