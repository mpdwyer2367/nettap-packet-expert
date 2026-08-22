# Lovable analyst console integration

The Lovable `Network Insights Chat` application is imported under `console/`
as a reviewed source snapshot from its connected GitHub repository,
`mpdwyer2367/net-chat-insight`, at commit
`386e4bc86075c53764c27dfe1fc59a22924304e8`. Its upstream history remains in
that repository. The NetTAP snapshot deliberately excludes Lovable planning
instructions and the tracked upstream `.env`; appliance-specific integration
changes live on a separate feature branch.

## Selected product capabilities

The pre-production console retains the strongest application workflows:

- investigations with persistent message history;
- PCAP/PCAPNG, flow, log, SNMP and WMI dataset ingestion;
- live capture and collector views;
- evidence-linked tool calls and side-panel records;
- telemetry charts, topology diagrams and downloadable reports;
- cases, document library, audit, retention and capacity views.

The original browser-selected Ollama URL and hosted model fallback are not part
of the appliance integration. Browser inference now uses authenticated
same-origin routes. Those routes forward only `tags`, `show` and `chat` to
Ollama on the internal Docker network and force the release model contract:

```text
nettap-ai:0.4.0-rc.1
```

The legacy `/api/chat` hosted-inference route returns HTTP 410. Deterministic
hashed embeddings replace remote embedding calls, so telemetry and document
text is not sent to an AI gateway.

## Pre-production boundary

The console remains optional and does not replace the release-qualified Open
WebUI experience. Start it with the explicit Compose overlay only after
configuring a dedicated Supabase project:

```bash
cp .env.example .env
# Set SUPABASE_URL, SUPABASE_WSS_URL, SUPABASE_PUBLISHABLE_KEY and
# SUPABASE_SERVICE_ROLE_KEY in .env, then:
./scripts/start-console.sh
```

The console is served through a separate TLS gateway on port `9443` by default.
Ollama is never published to the host. The console container has egress because
its current persistence, authentication and realtime features use Supabase;
therefore it is excluded from the fully offline OVA acceptance claim until the
data plane is migrated to an appliance-local service.

## Promotion gates

Before promoting the console from pre-production:

1. deploy a dedicated Supabase project and apply every checked-in migration;
2. verify row-level security with two independent tenants;
3. replace all bootstrap credentials and rotate the service-role key;
4. run authenticated PCAP, PCAPNG, flow and report end-to-end tests;
5. verify the browser cannot reach Ollama directly or select another model;
6. verify `/api/chat` returns 410 and an unavailable Ollama model fails closed;
7. complete dependency, container, secret and CSP scanning;
8. document backup, restore, retention and incident-response ownership.
