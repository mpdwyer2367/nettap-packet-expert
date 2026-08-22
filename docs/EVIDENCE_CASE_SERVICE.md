# NetTAP Network Intelligence — Evidence Workspace

## Purpose and status

The Evidence Workspace is the first local evidence-ingestion and case-analysis
service for NetTAP Network Intelligence. It turns approved PCAP metadata, normalized logs and flow
records into a persistent case with source provenance, evidence-quality warnings,
deterministic summaries, evidence-bound findings, a Markdown report and a
minimized context suitable for an authorized NetTAP assistant.

This implementation is an **evaluation feature for the next suite release**. It
does not make `0.4.0-rc.1` production-certified and is not a live NetTAP NPB,
flow collector, SIEM, IDS/IPS, NDR or autonomous controller.

## Local access

After `start-macos.sh` or `start-windows.ps1` completes:

- Workspace: `http://127.0.0.1:3200`
- Health: `http://127.0.0.1:3200/health`
- Bearer token: generated locally in `.evidence-api-token`

The service is bound to loopback by the local Compose profile. Every case and
evidence API requires its generated bearer token. The health endpoint and static
workspace shell do not disclose case data.

The production Compose profile keeps the service off direct host ports and
routes `https://<approved-hostname>:8443/evidence/` through the existing TLS
gateway. The same independent bearer token is still required for every case and
evidence API. Open WebUI does not expose that token to the browser: the managed
Packet Expert attachment filter uses it only on the private Docker network.

## Workflow

### Packet Expert chat upload

1. Sign in to Open WebUI at `http://127.0.0.1:3100`.
2. Select **NetTAP Network Intelligence — Packet Expert**.
3. Drag a supported file onto the chat or use the attachment button.
4. Ask Packet Expert to analyze the attached evidence.
5. Review the returned evidence IDs, quality warnings, limitations and findings.

The managed filter creates a case, hashes and uploads the source to the Evidence
Workspace, runs deterministic analysis, and adds only the minimized context to
the model request. It is not attached to the Network & Visibility profile.

Supported chat attachments are `.pcap`, `.pcapng`, `.json`, `.jsonl`, `.ndjson`, `.log`,
`.txt`, `.png`, `.jpg`, `.jpeg`, and `.webp`. The classic PCAP path performs the
built-in metadata decode documented below. Images are signature-validated and
passed to the multimodal model with explicit untrusted-input instructions.

The governed upload ceiling is 100 MiB (104,857,600 bytes) per file. Evidence
files are hashed in bounded chunks and streamed from Open WebUI to the Evidence
Workspace instead of being loaded into memory as a second complete copy.

### Evidence Workspace case workflow

1. Create a case with a clear objective and environment.
2. Select the source type and upload authorized evidence.
3. Record the observation point, timezone, clock status, exporter, schema and
   chain-of-custody reference.
4. Review the computed SHA-256, parser identity, record count and quality gaps.
5. Run deterministic analysis.
6. Review findings as observations or hypotheses with exact, resolvable citations
   and validation steps.
7. Export the Markdown report or the minimized LLM-safe context.

The browser UI stores the bearer token only in the page's JavaScript memory;
reloading the page requires the token again.

## Supported evidence

| Source type | Accepted input | Built-in behavior |
|---|---|---|
| `pcap` | Classic PCAP or PCAPNG enhanced-packet blocks, Ethernet or raw IP link type | IPv4/IPv6 and basic TCP/UDP/ICMP/GRE/ESP metadata; no application payload extraction |
| `normalized-pcap` | JSON object, JSON array or JSONL | Validates objects, maps common fields and redacts sensitive keys |
| `ipfix` | Normalized JSON/JSONL | Preserves exporter/template/sampling metadata and common five-tuple fields |
| `netflow` | Normalized JSON/JSONL | Maps common flow aliases and records schema limitations |
| `sflow` | Normalized JSON/JSONL | Maps common flow aliases and records sampling limitations |
| `cloud-flow` | Normalized JSON/JSONL | Maps common cloud-flow fields after external schema normalization |
| `syslog` | UTF-8 lines | Extracts priority, facility, severity, host and bounded message text into the protected normalized store; raw lines remain excluded from LLM context |
| `json` / `jsonl` | UTF-8 JSON objects | Generic schema-bounded import |

The dependency-free PCAPNG path validates section, interface, and
enhanced-packet block boundaries, supports per-interface timestamp resolution,
and emits the same payload-free packet metadata as classic PCAP. It does not
expand every PCAPNG block family or replace deeper, resource-isolated TShark
normalization. The OVA acceptance additionally proves that its pinned guest
TShark can decode both formats before upload.

## API contract

The machine-readable OpenAPI 3.1 contract is in [`api/openapi.json`](../api/openapi.json).

Create a case:

```bash
curl --fail --silent \
  -H "Authorization: Bearer $EVIDENCE_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"title":"Investigate service latency","objective":"Identify evidence-supported causes","environment":"Authorized lab"}' \
  http://127.0.0.1:3200/v1/cases
```

Evidence upload uses an octet-stream body, required `source_type` and `filename`
query parameters, optional `X-Content-SHA256`, and base64url-encoded JSON in
`X-NetTAP-Metadata`. The UI constructs this request automatically.

Principal endpoints:

| Method and path | Result |
|---|---|
| `POST /v1/cases` | Create a case |
| `GET /v1/cases` | List case summaries |
| `GET /v1/cases/{id}` | Case, sources and latest analysis |
| `POST /v1/cases/{id}/evidence` | Hash, retain and normalize one source |
| `POST /v1/cases/{id}/analyze` | Run deterministic analysis |
| `GET /v1/cases/{id}/observations/{observation_id}` | Resolve one normalized-observation citation within its owning case |
| `GET /v1/cases/{id}/analyses/{analysis_id}` | Retrieve and verify the canonical deterministic artifact within its owning case |
| `GET /v1/cases/{id}/context` | Return minimized LLM-safe context |
| `GET /v1/cases/{id}/report.md` | Return a reviewable Markdown report |

## Evidence and LLM boundary

Raw source bytes are stored under server-generated UUID paths in the dedicated
evidence volume with restrictive permissions. Original filenames never determine
storage paths. The API does not provide a raw-evidence download endpoint.

For a chat attachment, Open WebUI first stages the source in its own local upload
directory so the managed filter can read it. The Evidence Workspace then retains
its analyzed copy. Both the Open WebUI and evidence volumes must therefore be
handled as sensitive evidence stores for backup, retention and deletion. The raw
bytes are not included in the Ollama request.

The LLM context contains only:

- case objective and environment;
- evidence IDs, hashes, parser identities and bounded provenance metadata;
- quality warnings;
- deterministic aggregate metrics;
- evidence-bound observations and hypotheses; and
- explicit model handling instructions.

It does not contain packet payloads, raw log lines, TLS secrets or raw evidence.
Only reviewed scalar provenance fields are eligible for the context; arbitrary
metadata is omitted. Sensitive structured keys such as passwords, tokens,
private keys and session keys are redacted during normalization. The original
source remains sensitive and must be protected according to customer retention
and legal-hold requirements.

Findings use typed citations to evidence manifests, exact normalized observations,
and a SHA-256-bound deterministic analysis artifact. The browser resolves an
observation only through the owning case path. Cross-case references return `404`,
and successful resolution creates an audit event. The analysis hash is an integrity
reference, not a digital signature.

## Deterministic analysis in this increment

- protocol, endpoint, destination-port and conversation counts;
- bytes by conversation when present;
- source timestamp range;
- TCP reset and capture-truncation observations;
- evidence-quality gaps;
- dominant-conversation observation-point warning; and
- regular connection timing as a medium-confidence investigation hypothesis.

Regular timing is never reported as confirmed command-and-control. The report
requires correlation with authorized asset, DNS, application, identity and
longer-baseline evidence.

## Security controls

- generated 256-bit bearer token;
- constant-time token comparison;
- loopback-only local port;
- internal Docker networks with no outbound route;
- request-size and record-count limits;
- strict source-type allowlist;
- server-computed SHA-256 and optional supplied-hash verification;
- UUID storage paths and filename traversal prevention;
- SQLite foreign keys, transactions and per-case isolation;
- read-only container filesystem, dropped capabilities and no-new-privileges;
- no raw-evidence retrieval API;
- no decryption, code execution, external lookup or autonomous change action; and
- backup/restore coverage for the dedicated evidence volume.

The current bearer token is an appliance-local evaluation control, not enterprise
identity. Before customer production approval, add Open WebUI/enterprise identity
integration, per-role case authorization, token rotation/revocation, encrypted
storage requirements, retention/deletion/legal-hold workflows, malware/parser
isolation, tamper-evident audit export and penetration-test evidence.

## Backup and recovery

Backup format v3 includes `evidence-data.tgz` in addition to Ollama and Open
WebUI data. Treat it as highly sensitive because it contains cases and original
evidence. Restore remains non-overwriting and accepts historical v2 backups
without an evidence volume.

## Next integration gate

The next decoder increment should package a resource-isolated, version-pinned
TShark worker for deeper protocol normalization, additional PCAPNG block
families, derived-artifact hashing, and malicious-input tests. The current
managed chat path uses the bounded built-in PCAP/PCAPNG metadata parser. No
write-capable NetTAP NPB or device connector should be added
until read-only acquisition, audit, validation and rollback controls pass.
