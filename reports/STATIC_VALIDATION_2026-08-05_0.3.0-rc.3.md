# Static validation — NetTAP AI Suite 0.3.0-rc.3

Date: 2026-08-05

Result: **PASS for available engineering checks**

## Passed

- Bash syntax for shell entry points
- Python compilation for both provisioning programs
- Mock Open WebUI v0.11.0 API-contract test covering authentication, managed knowledge, managed Skill creation/update and exact attachment, synchronous file ingestion, retrieval proof, Workspace Model creation/update, default selection, preserved access grants and configuration, repeat execution, and no duplicate objects
- Deterministic provisioning fingerprint test
- Profile manifest parsing and referenced-file checks
- Both profiles resolve to one `nettap-ai:0.3.0-rc.3` runtime model and one combined Modelfile
- Both specialist Skills are source-controlled, checksum-pinned, and attached only to their matching profile
- Combined-model bundle build and verification paths, including archive path safety, maximum member size, source hashes, model identity and explicit exclusion of weights
- Exact offline embedding repository/revision configuration and local-only runtime controls
- Production configuration structural assertions
- Launcher definitions select distinct managed Workspace Model IDs
- Required documentation and relative links
- Default-password, secret, private-key, stale-license, and macOS Bash compatibility checks
- Git whitespace validation
- Native Ollama `0.32.5` base-model download and combined-model creation in an isolated Linux x86_64 store
- Exact base and combined Ollama manifest identity verification
- Full 7.6B/Q4_K_M CPU model load and prompt-evaluation start
- Native installer large-Modelfile regression test, preventing a false SIGPIPE failure under `pipefail`

Commands:

```bash
./tests/static-checks.sh
./tests/native-model-installer-mock.sh
python3 -m unittest -v tests/test_provision_open_webui.py
python3 -m py_compile provisioning/*.py
```

## Unavailable in this workspace

- Docker and Docker Compose rendering
- Actual Open WebUI container start, managed Skill rendering/behavior, and exact-revision embedding download
- Actual local embedding computation and Open WebUI vector indexing
- Caddy runtime configuration validation
- ShellCheck
- PowerShell parser
- Completed native token generation and model-store sharing measurement on supported target hosts
- Browser, authentication, RBAC, backup, restore, update, and rollback acceptance
- macOS and Windows target-host evidence

The native model was created and fully loaded in the restricted Linux workspace;
the runner was terminated during the 4.7 GB token-generation workload, so no
inference PASS is claimed. See `NATIVE_MODEL_CREATION_2026-08-05_0.3.0-rc.3.md`.
The mock API test validates the provisioner's control flow and idempotence; it is
not a substitute for the actual pinned Open WebUI container, embedding model, or
target-host runtime test. These unavailable checks remain release gates. This
PASS is not production certification or customer deployment approval.
