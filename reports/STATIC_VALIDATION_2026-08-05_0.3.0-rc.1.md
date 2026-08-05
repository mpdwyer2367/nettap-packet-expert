# Static validation — NetTAP AI Suite 0.3.0-rc.1

Date: 2026-08-05

Result: **PASS for available source-only checks**

## Passed

- Bash syntax for shell entry points
- Assistant manifest parsing and referenced-file checks
- One approved base-model identity across both assistant manifests
- Required shared safety controls in both Modelfiles
- Network & Visibility packet-routing boundary
- Packet Expert live-evidence and configuration boundaries
- Production configuration structural assertions
- Loopback launcher definitions and security controls
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
- Ollama inference and shared-blob measurement
- Open WebUI browser, authentication, launcher, knowledge, RBAC, backup, restore, update, and rollback acceptance
- macOS and Windows target-host evidence

These unavailable checks remain release gates. This source-only PASS is not a production certification or customer deployment approval.
