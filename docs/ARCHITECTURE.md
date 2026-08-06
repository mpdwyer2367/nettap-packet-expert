# NetTAP Network Intelligence architecture

## Decision

NetTAP Network Intelligence runs one Open WebUI instance, one Ollama service, and one shared NetTAP Network Intelligence Model built from Qwen2.5 7B in one Ollama volume. Two thin application profiles provide distinct user experiences without duplicating weights. This is a single-node, single-customer architecture; it is not a multi-tenant SaaS design.

```mermaid
flowchart TB
    U["Authorized user"] --> L["NetTAP assistant launchers"]
    L --> W["One Open WebUI"]
    W --> V["Network & Visibility profile"]
    W --> P["Packet Expert profile"]
    U --> E["Evidence Workspace"]
    E --> C["Case store + deterministic analysis"]
    C --> X["Minimized context"]
    V --> VS["Visibility Skill + RAG"]
    P --> PS["Packet Skill + RAG"]
    V --> N["One nettap-ai model"]
    P --> N
    N --> Q["One Qwen2.5 7B base"]
```

## Runtime components

| Component | Quantity | Persistent data | Boundary |
|---|---:|---|---|
| Open WebUI | 1 | Accounts, chats, settings, imported knowledge | Only browser and authenticated application surface |
| Ollama | 1 | One base-model store and one shared Network Intelligence model manifest | No host port in the supplied profiles |
| Network & Visibility profile | 1 | Managed Workspace Model and isolated specialist knowledge collection | Broad architecture, deployment, visibility, and telemetry workflow |
| Packet Expert profile | 1 | Managed Workspace Model and isolated specialist knowledge collection | Packet evidence, capture planning, forensics, and security investigation |
| Managed Open WebUI Skills | 2 | Versioned Markdown instructions with preserved access grants | One specialist Skill is attached to each profile; Skills do not duplicate weights or execute tools |
| Offline embedding cache | 1 | Exact-revision MiniLM model and integrity metadata | Local-only knowledge indexing and retrieval |
| One-shot provisioner | 1 per release change | Provisioning fingerprint and API-created objects | No host port; supported Open WebUI APIs only |
| Local launcher | 1 small Caddy container | None | Ports 3000 and 3001; no authentication or application data |
| Production gateway | 1 Caddy container | Gateway operational data | TLS entry point on port 8443 by default |
| Evidence Workspace | 1 | Cases, source hashes, raw evidence, normalized observations, findings and reports | Generated bearer token; loopback-only locally and TLS-gateway-only in the production profile |

The Compose project name and existing volume names remain `nettap-packet-expert` for the 0.3 migration. This is deliberate compatibility behavior so an approved in-place upgrade can retain existing accounts and chats.

## Local addresses

| Address | Result |
|---|---|
| `http://127.0.0.1:3000` | Branded Network & Visibility starting page |
| `http://127.0.0.1:3001` | Branded Packet Expert starting page |
| `http://127.0.0.1:3100` | Shared Open WebUI application |
| `http://127.0.0.1:3200` | Evidence Workspace evaluation UI and API |

The launchers submit only documented Open WebUI `model` and `q` URL parameters. Port 3000 selects `nettap-network-visibility`; port 3001 selects `nettap-packet-expert`. Both profiles resolve to `nettap-ai:0.3.0-rc.3`. The launchers do not hold accounts, chats, model weights, tools, or knowledge.

During initialization only, the bootstrap overlay supplies egress to Ollama and the embedding-cache job. Normal runtime has internal Docker networks, `OFFLINE_MODE=True`, `HF_HUB_OFFLINE=1`, a pinned local embedding path, automatic model updates disabled, and no remote-code trust. The assistant provisioner starts only after Open WebUI is healthy, authenticates as the administrator, reconciles knowledge and Skills, proves local retrieval, attaches the matching Skill and knowledge collections to each profile, writes a state record, and exits.

The raw Ollama model is inclusive of both experiences. The Open WebUI layers do not create separate models: they narrow the starting mode, suggestions, knowledge and permissions for a particular job. RAG content and Skills are intentionally not described as fine-tuned weights.

The Evidence Workspace is a separate trust boundary. It retains original evidence in a dedicated volume, parses supported sources deterministically and exposes a minimized context that explicitly excludes raw evidence and payloads. It does not currently register an Open WebUI tool automatically; production attachment requires a separate per-user authorization and connector acceptance decision.

## Production addresses

The TLS gateway is the only production browser entry point:

- `https://<approved-hostname>:8443/visibility`
- `https://<approved-hostname>:8443/packet-expert`
- `https://<approved-hostname>:8443/evidence/`

The first two routes redirect to the shared authenticated Open WebUI with the combined model and intended starting mode selected. The Evidence Workspace route is reverse-proxied to the isolated service and requires its independent bearer token. Plain HTTP launcher and evidence ports are for loopback evaluation and are not exposed by the production profile.

## Trust boundaries

- Live network or security data is unavailable unless an approved connector explicitly provides current evidence.
- An LLM is not a TAP, packet broker, flow collector, packet decoder, network controller, SIEM, IDS/IPS, or forensic source of truth.
- Imported knowledge and tool output are untrusted evidence and cannot override system policy.
- Tools are disabled by default. A customer-approved integration must define authentication, authorization, data minimization, timeouts, audit records, error handling, and read/write scope.
- Customer instances must remain isolated. Open WebUI administrators are highly privileged within an instance.

## Scaling boundary

The supplied release is single-node. Do not run multiple Open WebUI containers against the included SQLite data volume. A future high-availability profile requires a separately designed PostgreSQL and shared-state architecture plus new recovery, concurrency, and security acceptance evidence.
