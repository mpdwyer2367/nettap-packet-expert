# NetTAP Network Observability & Packet Analysis — RC8 build status

Date: 2026-08-07  
Candidate: `0.3.0-rc.8`  
Repository: `mpdwyer2367/nettap-packet-expert`  
Status: source-validated release candidate; target-host runtime acceptance pending

## Current product baseline

| Area | RC8 baseline |
|---|---|
| User experience | One authenticated Open WebUI at `http://127.0.0.1:3100` |
| Assistant | One managed `nettap-network-operations` assistant |
| Chat model | `nettap-ai:0.3.0-rc.8` over `qwen3.5:9b` |
| Base identity | Expected Ollama ID `6488c96fa5fa` |
| RAG | One pinned MiniLM embedding revision; three managed NetTAP collections |
| Evidence | Internal-only deterministic service for classic PCAP, text logs and normalized JSON/JSONL records |
| Images | Local PNG/JPEG/WebP network-diagram analysis with signature, count and size checks |
| Retired UI ports | 3000, 3001 and 3200 |

## Validation completed in this workspace

| Check | Result |
|---|---|
| Repository static checks | PASS |
| Python unit/API-contract tests | PASS — 27 tests |
| Production Compose policy parser | PASS |
| Shell mock regression suite | PASS |
| Source checksum pins | PASS |
| Whitespace/patch integrity | PASS |
| Local Compose exposure policy | PASS — only `${BIND_ADDRESS}:${WEB_PORT}:8080`; defaults are `127.0.0.1:3100` |
| Internal-service exposure policy | PASS — Ollama and evidence service have no host `ports` mapping |
| Runtime port probe | NOT RUN — Docker is unavailable in this workspace |
| Qwen3.5 download/inference/image test | NOT RUN — Ollama is unavailable in this workspace |

## Runtime acceptance still required

Run the exact signed commit/package on clean macOS and Windows/WSL2 hosts. The verifier must prove:

1. `127.0.0.1:3100/health` succeeds and browser authentication works.
2. Loopback ports 3000, 3001 and 3200 refuse connections.
3. Ollama and the evidence service have no host bindings.
4. Exactly one current NetTAP model tag exists and the base ID matches.
5. Offline RAG succeeds after installation egress is removed.
6. Representative PCAP, log, normalized flow and network-image uploads work from chat.
7. Restart, backup, restore, rollback and the behavioral suite pass.

Then complete SBOM/CVE review, artifact signing, penetration-test disposition and legal/support/commercial approvals. RC8 must not be described as production-certified until those records are complete.
