# Security and evidence boundary

This release candidate is a local decision-support assistant, not an autonomous security control, packet capture engine, IDS, NDR, SIEM, or source of ground truth.

- The UI binds to `127.0.0.1` by default.
- Authentication is enabled and the first account becomes administrator.
- Later accounts default to pending.
- Code execution, the code interpreter, and automatic package installation are disabled.
- Ollama is not published to the host. It can reach the model registry through a separate egress network so the declared base model can be downloaded.
- Persistent chat and model data remain in Docker volumes.
- Operators must not upload secrets, credentials, personal content, or unminimized packet payload.

Before any non-local exposure, deploy an approved TLS reverse proxy, restrict source networks, configure organizational identity controls, back up volumes, define retention, review audit requirements, and perform threat modeling and penetration testing.

For vulnerability reports, use a private GitHub security advisory after the repository is created. Do not open a public issue containing exploit details or secrets.
