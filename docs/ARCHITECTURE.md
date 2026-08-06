# NetTAP Network Intelligence architecture

## Decision

NetTAP Network Intelligence runs one Open WebUI instance, one Ollama service, and one shared NetTAP Network Intelligence Model built from Qwen2.5 7B in one Ollama volume. Two thin application profiles provide distinct user experiences without duplicating weights. This is a single-node, single-customer architecture; it is not a multi-tenant SaaS design.

```mermaid
flowchart TB
    U["Authorized user"] --> L["Branded launchers"]
    L --> W["One authenticated Open WebUI"]
    W --> V["Network & Visibility profile"]
    W --> P["Packet Expert profile"]
    V --> VR["Visibility Skill + RAG"]
    P --> PR["Packet Skill + RAG"]
    V --> O["One Ollama service"]
    P --> O
    O --> M["nettap-ai:0.3.0-rc.6"]
    M --> Q["One pinned Qwen2.5 7B base"]
    U --> E["Evidence Workspace"]
    E --> D["Deterministic parsers + case store"]
    D --> X["Minimized evidence context"]
    X --> T["Admin-scoped read-only tool"]
    T --> P
```

The evidence tool is an automatic read-only case-context connector, not a live
telemetry feed. Raw PCAP, logs and flow records remain in the dedicated evidence
volume; only minimized context, deterministic findings, provenance and quality
warnings reach Packet Expert.

## Model installation and replacement

```mermaid
flowchart TB
    G["Reviewed GitHub release"] --> T["Temporary install-only egress"]
    T --> Q["Pull and verify one Qwen base"]
    T --> R["Cache and pin one RAG embedding model"]
    Q --> C["Create nettap-ai:0.3.0-rc.6"]
    C --> P["Provision both Open WebUI profiles"]
    R --> P
    P --> V["Verify model identity and offline retrieval"]
    V --> X["Retire older NetTAP container tags"]
    X --> F["Offline runtime with one NetTAP model tag"]
```

The Qwen base remains in the Ollama store because it supplies the model weights;
it is not a second NetTAP assistant. The MiniLM embedding dependency remains in
Open WebUI storage because it provides offline RAG and is not a chat LLM.

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
| Welcome and experience launcher | 1 small Caddy container | None | Branded local pages on ports 3000 and 3001; no credentials, authentication database, chats, or model data |
| Evidence assistant connector | Managed OpenAPI tool server | Existing evidence token | Read-only case inventory and minimized context; attached to Packet Expert for the provisioning administrator |
| Production gateway | 1 Caddy container | Gateway operational data | TLS entry point on port 8443 by default |
| Evidence Workspace | 1 | Cases, source hashes, raw evidence, normalized observations, findings and reports | Generated bearer token; loopback-only locally and TLS-gateway-only in the production profile |

The canonical Compose project name is `nettap-network-intelligence`. Fresh
installs use new canonical volumes and a non-personal administrator bootstrap.
Startup stops any legacy `nettap-packet-expert` containers without deleting
their volumes. Legacy accounts, chats, models, and knowledge enter the product
only through an explicit backup, restore, and migration review; stale account
state is never attached implicitly.

## Local addresses

| Address | Result |
|---|---|
| `http://127.0.0.1:3000` | Branded Network & Visibility welcome, authentication guidance, and guided starts |
| `http://127.0.0.1:3001` | Branded Packet Expert welcome, authentication guidance, and guided starts |
| `http://127.0.0.1:3100` | Shared Open WebUI application |
| `http://127.0.0.1:3200` | Evidence Workspace evaluation UI and API |

The welcome pages submit only documented Open WebUI `model` and `q` URL parameters. Port 3000 selects `nettap-network-visibility`; port 3001 selects `nettap-packet-expert`. Both profiles resolve to `nettap-ai:0.3.0-rc.6`. The pages may display Open WebUI health, but they do not accept credentials or hold accounts, sessions, chats, model weights, tools, or knowledge. Open WebUI performs authentication and preserves the intended profile selection across sign-in.

During initialization only, the bootstrap overlay supplies egress to Ollama and the embedding-cache job. Normal runtime has internal Docker networks, `OFFLINE_MODE=True`, `HF_HUB_OFFLINE=1`, a pinned local embedding path, automatic model updates disabled, and no remote-code trust. The assistant provisioner starts only after Open WebUI and Evidence Workspace are healthy, authenticates as the administrator, reconciles knowledge and Skills, proves local retrieval, registers the read-only evidence tool for Packet Expert, attaches the matching Skill and knowledge collections to each profile, writes a state record, and exits. The default RC6 lifecycle then removes recognized older NetTAP tags from the containerized Ollama store; it never removes the current model, approved base, non-NetTAP models, or application volumes.

The raw Ollama model is inclusive of both experiences. The Open WebUI layers do not create separate models: they narrow the starting mode, suggestions, knowledge and permissions for a particular job. RAG content and Skills are intentionally not described as fine-tuned weights.

The Evidence Workspace is a separate trust boundary. It retains original evidence in a dedicated volume, parses supported sources deterministically and exposes a minimized context that explicitly excludes raw evidence and payloads. Provisioning registers its read-only OpenAPI contract and attaches it to Packet Expert for the provisioning administrator. Broader user access requires per-case authorization and separate acceptance.

### Citation boundary

Evidence database schema v2 separates three citation targets: the immutable evidence
manifest, an exact normalized observation, and the deterministic analysis artifact.
Observation citations use a server-generated observation UUID plus the owning case and
evidence UUID, source sequence number, and timestamp. The read-only resolver requires the
case and observation to match and audits successful access. It returns normalized metadata,
never the retained source bytes. Each analysis records a SHA-256 over canonical summary and
finding output; this detects output drift but is not a release signature or tamper-evident
audit chain. See [ADR 0001](decisions/0001-resolvable-evidence-citations.md).

## Production addresses

The TLS gateway is the only production browser entry point:

- `https://<approved-hostname>:8443/visibility/`
- `https://<approved-hostname>:8443/packet-expert/`
- `https://<approved-hostname>:8443/evidence/`

The first two routes serve the branded product welcome pages through the TLS gateway. Their sign-in and guided-start actions redirect to the shared authenticated Open WebUI with the intended managed profile selected. The Evidence Workspace route is reverse-proxied to the isolated service and requires its independent bearer token. Plain HTTP launcher and evidence ports are for loopback evaluation and are not exposed by the production profile.

## Trust boundaries

- Live network or security data is unavailable unless an approved connector explicitly provides current evidence.
- An LLM is not a TAP, packet broker, flow collector, packet decoder, network controller, SIEM, IDS/IPS, or forensic source of truth.
- Imported knowledge and tool output are untrusted evidence and cannot override system policy.
- The managed evidence tool is read-only and administrator-scoped. Other tools remain disabled unless a customer-approved integration defines authentication, authorization, minimization, timeouts, audit records, error handling and read/write scope.
- Customer instances must remain isolated. Open WebUI administrators are highly privileged within an instance.

## Scaling boundary

The supplied release is single-node. Do not run multiple Open WebUI containers against the included SQLite data volume. A future high-availability profile requires a separately designed PostgreSQL and shared-state architecture plus new recovery, concurrency, and security acceptance evidence.
