# Static validation: 0.4.0-rc.1

Date: 2026-08-20

Result: **PASS**

Validated in the source workspace:

- `./tests/static-checks.sh`
- 19 provisioning, archive-safety and Evidence Workspace Python tests
- native Ollama installer mock regression
- legacy NetTAP model-retirement mock regression
- Bash syntax and Git whitespace checks

The checks confirm one `nettap-ai:0.4.0-rc.1` runtime model for both profiles, the explicit `qwen3.5:9b-q4_K_M` base, expected Ollama ID `6488c96fa5fa`, 16,384-token configured context, release-manifest consistency, offline RAG source checksums and fail-closed release status.

This is source-level evidence only. The 6.6 GB base was not pulled and no clean macOS, Windows/WSL2 or native Linux runtime was certified by this report. Production and commercial approval remain not granted.
