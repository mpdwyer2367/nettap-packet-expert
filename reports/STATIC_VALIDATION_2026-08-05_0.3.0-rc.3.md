# Static validation — NetTAP AI Suite 0.3.0-rc.3

Date: 2026-08-05

Result: **PASS for available source-only checks**

## Passed

- Bash syntax for shell entry points
- Python compilation for both provisioning programs
- Mock Open WebUI v0.11.0 API-contract test covering authentication, managed knowledge, synchronous file ingestion, retrieval proof, Workspace Model creation/update, default selection, preserved configuration, repeat execution, and no duplicate objects
- Deterministic provisioning fingerprint test
- Profile manifest parsing and referenced-file checks
- Both profiles resolve to one `nettap-ai:0.3.0-rc.3` runtime model and one combined Modelfile
- Exact offline embedding repository/revision configuration and local-only runtime controls
- Production configuration structural assertions
- Launcher definitions select distinct managed Workspace Model IDs
- Required documentation and relative links
- Default-password, secret, private-key, stale-license, and macOS Bash compatibility checks
- Git whitespace validation

Commands:

```bash
./tests/static-checks.sh
python3 -m unittest -v tests/test_provision_open_webui.py
python3 -m py_compile provisioning/*.py
```

## Unavailable in this workspace

- Docker and Docker Compose rendering
- Actual Open WebUI container start and exact-revision embedding download
- Actual local embedding computation and Open WebUI vector indexing
- Caddy runtime configuration validation
- ShellCheck
- PowerShell parser
- Ollama model pull, creation, inference, and model-store measurement
- Browser, authentication, RBAC, backup, restore, update, and rollback acceptance
- macOS and Windows target-host evidence

The mock API test validates the provisioner's control flow and idempotence; it is not a substitute for the actual pinned Open WebUI container, embedding model, or target-host runtime test. These unavailable checks remain release gates. This source-only PASS is not production certification or customer deployment approval.
