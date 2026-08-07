# Current candidate state

| Item | RC7 state |
|---|---|
| Repository | `mpdwyer2367/nettap-packet-expert` |
| Release | `0.3.0-rc.7` candidate |
| User interface | One authenticated Open WebUI on local port 3100 |
| Assistant | `nettap-network-operations` |
| Model | One `nettap-ai:0.3.0-rc.7` manifest over the approved Qwen2.5 7B base |
| Knowledge | Shared, network visibility and packet-analysis collections |
| Evidence ingestion | Managed chat Filter to an internal deterministic service |
| Public legacy pages | Removed: ports 3000, 3001 and 3200 |

Source-level parser, provisioning and configuration tests are part of the repository. The candidate must not be called production-certified until the exact commit/package passes clean macOS and Windows/WSL2 runtime acceptance plus the release gates listed in `docs/COMMERCIAL_RELEASE_GATES.md`.
