# Static validation — NetTAP AI Suite 0.3.0-rc.2

Date: 2026-08-05

Result: **PASS for available source-only checks**

## Passed

- Bash syntax for shell entry points
- Profile manifest parsing and referenced-file checks
- Both profiles resolve to one `nettap-ai:0.3.0-rc.2` runtime model and one combined Modelfile
- One approved Qwen2.5 base-model identity
- Combined Network & Visibility, Packet Expert, cross-domain, evidence, safety, and configuration controls
- Production configuration structural assertions
- Both loopback launcher definitions select the same runtime model with profile-specific starting modes
- Required documentation and relative links
- Default-password, secret, private-key, stale-license, and macOS Bash compatibility checks
- Python syntax for production configuration validation
- Git whitespace validation

Command:

```bash
./tests/static-checks.sh
```

## Unavailable in this workspace

- Docker and Docker Compose rendering
- Caddy runtime configuration validation
- ShellCheck
- PowerShell parser
- Container image pull and model download
- Ollama inference and model-store measurement
- Open WebUI browser, authentication, Workspace Model, knowledge, RBAC, backup, restore, update, and rollback acceptance
- macOS and Windows target-host evidence

These unavailable checks remain release gates. This source-only PASS is not a production certification or customer deployment approval.
