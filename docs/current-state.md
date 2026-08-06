# Current repository state

## Source identity

- Repository: `mpdwyer2367/nettap-packet-expert`
- Branch inspected: `main`
- Merged baseline commit: `356a0cd31770e32745a6ddc3f7f158aba0a46a7b`
- Baseline includes merged PRs #12 through #16 and the RC4 one-model candidate.
- This assessment records local development after that commit; it is not a release acceptance record.

## Working foundation

| Boundary | Current implementation |
|---|---|
| Network & Visibility | Branded launcher on loopback port 3000 and a managed Open WebUI profile |
| Packet Expert | Branded launcher on loopback port 3001 and a distinct managed Open WebUI profile |
| Shared administration | One Open WebUI instance on loopback port 3100 |
| Evidence Workspace | Authenticated local service on loopback port 3200 |
| Model | One `nettap-ai:0.3.0-rc.4` definition over `qwen2.5:7b-instruct-q4_K_M` |
| Skills | Two managed Skills attached only to their matching profiles |
| Knowledge and RAG | Three checksum-pinned managed collections and one pinned offline embedding revision |
| Storage | Separate Ollama, Open WebUI, evidence, and gateway volumes |
| Installer | macOS, Windows/WSL2, and native Ollama entry points with identity checks |
| Recovery | Backup format v3, non-overwriting restore, failed-update harness, and legacy-model retirement controls |

The Evidence Workspace can create cases, ingest classic PCAP metadata and normalized
JSON/JSONL, syslog, flow, and cloud-flow records, retain original evidence under
server-generated paths, compute SHA-256, record provenance limitations, run bounded
deterministic aggregation, and export minimized context and Markdown reports.

## Baseline validation actually run

On the macOS development host, against the baseline commit:

- `./tests/static-checks.sh`: passed after installing PyYAML 6.0.3 in an isolated temporary virtual environment.
- Python service/provisioning/archive suite: 17 tests passed.
- `tests/native-model-installer-mock.sh`: passed.
- `tests/normalized-ingestion-eval.sh`: not accepted as a pass. The shared local Ollama volume contained RC3 and RC5 but not `nettap-ai:0.3.0-rc.4`; offline execution refused the resulting registry pull.

These results do not constitute clean-host macOS, Windows/WSL2, Linux, production,
security, signing, or commercial acceptance.

## Current incomplete or unsafe boundaries

- The appliance-local bearer token is not user identity, RBAC, or case-level tenancy.
- PCAPNG has no packaged, resource-isolated TShark worker and is rejected with normalization guidance.
- Classic-PCAP parsing is dependency-free metadata extraction, not full DNS/TLS/TCP analysis.
- Evidence lifecycle states, retention, deletion, legal hold, parser quarantine, and encrypted-at-rest policy are incomplete.
- No documented real NetTAP device API or accepted hardware connector is present.
- No device write path is enabled.
- Clean platform acceptance, SBOM/vulnerability disposition, signed artifacts, penetration testing, and legal/support/commercial approvals remain blocked.

## Current implementation increment

Evidence database schema v2 adds exact, reviewable citations. Deterministic findings now
reference normalized observation UUIDs, evidence UUIDs, record sequence numbers, timestamps,
and a SHA-256-bound analysis artifact. Citation lookup is scoped by both case and observation,
audited, and exposed through a read-only API. The UI resolves normalized-observation
citations without exposing retained raw evidence.

The next priority is a packaged PCAP/PCAPNG parser-worker boundary with format detection,
resource limits, lifecycle states, derived-artifact hashing, and malicious-input tests.

## Citation increment validation actually run

- Full static checks, Compose configuration checks, and documentation-link checks: passed.
- Full Python case, provisioning, and archive suite: 19 tests passed.
- Native model installer and legacy-model retirement mock harnesses: passed.
- Python compilation, browser JavaScript syntax, and Git whitespace checks: passed.
- Isolated container HTTP workflow on loopback port 3210: passed authentication denial,
  case creation, IPFIX fixture ingestion, hashing, deterministic analysis, artifact hashing,
  minimized context, and Markdown report export. The temporary container and volume were removed.

The model-backed normalized-ingestion evaluation remains not run successfully for RC4 because
the local shared Ollama store does not contain `nettap-ai:0.3.0-rc.4`. It must not be recorded
as a pass until that exact candidate is installed and the evaluation completes offline.
