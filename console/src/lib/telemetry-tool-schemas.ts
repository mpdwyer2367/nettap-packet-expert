/**
 * Client-safe JSON-schema descriptions of the telemetry tools.
 *
 * These are sent to the local Ollama model (which needs raw JSON schema), while
 * the actual execution happens server-side via `runTelemetryTool`.
 */
import { HISTORY_SCHEMA_DOC } from "./history-sql";

export type OllamaToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

function obj(properties: Record<string, unknown>, required: string[]) {
  return { type: "object", properties, required, additionalProperties: false };
}

const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };

export const TELEMETRY_TOOL_NAMES = [
  "dataset_overview",
  "flow_aggregate",
  "flow_search",
  "log_search",
  "semantic_search",
  "get_records",
  "packet_search",
  "snmp_search",
  "wmi_search",
  "timeline",
  "render_chart",
  "render_diagram",
  "live_session_stats",
  "protocol_breakdown",
  "dns_analysis",
  "tls_inventory",
  "risk_exposure",
  "credential_exposure",
  "retention_status",
  "interface_utilization",
  "network_inventory",
  "history_sql",
] as const;



export type TelemetryToolName = (typeof TELEMETRY_TOOL_NAMES)[number];

export const TELEMETRY_TOOLS: OllamaToolDef[] = [
  {
    type: "function",
    function: {
      name: "dataset_overview",
      description:
        "Summarize the active telemetry dataset: record counts, time range, top talkers, protocols and observation points. Call this first for broad questions.",
      parameters: obj({}, []),
    },
  },
  {
    type: "function",
    function: {
      name: "flow_aggregate",
      description:
        "Aggregate flow records (IPFIX/NetFlow/packet-broker exports) to rank talkers, conversations, ports, protocols or observation points by bytes, packets or flow count.",
      parameters: obj(
        {
          group_by: {
            type: "string",
            enum: ["src_ip", "dst_ip", "conversation", "protocol", "dst_port", "observation_point"],
          },
          metric: { type: "string", enum: ["bytes", "packets", "flows"] },
          src_ip: nullableString,
          dst_ip: nullableString,
          protocol: nullableString,
          dst_port: nullableNumber,
          after: nullableString,
          before: nullableString,
          limit: nullableNumber,
        },
        [
          "group_by",
          "metric",
          "src_ip",
          "dst_ip",
          "protocol",
          "dst_port",
          "after",
          "before",
          "limit",
        ],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "flow_search",
      description:
        "Return individual flow records matching filters, largest first. Use this to gather citable evidence for a claim.",
      parameters: obj(
        {
          ip: nullableString,
          src_ip: nullableString,
          dst_ip: nullableString,
          protocol: nullableString,
          dst_port: nullableNumber,
          min_bytes: nullableNumber,
          after: nullableString,
          before: nullableString,
          limit: nullableNumber,
        },
        ["ip", "src_ip", "dst_ip", "protocol", "dst_port", "min_bytes", "after", "before", "limit"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "log_search",
      description:
        "Full-text search device/syslog records in the dataset, optionally filtered by severity, host or time window.",
      parameters: obj(
        {
          contains: nullableString,
          severity: nullableString,
          host: nullableString,
          after: nullableString,
          before: nullableString,
          limit: nullableNumber,
        },
        ["contains", "severity", "host", "after", "before", "limit"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "semantic_search",
      description:
        "Semantic (RAG) search over telemetry summaries for fuzzy questions such as 'unusual outbound behaviour' or 'signs of exfiltration'.",
      parameters: obj({ query: { type: "string" }, limit: nullableNumber }, ["query", "limit"]),
    },
  },
  {
    type: "function",
    function: {
      name: "get_records",
      description:
        "Fetch specific flow, log, packet, SNMP or WMI records by id so they can be cited as evidence.",
      parameters: obj(
        {
          table: { type: "string", enum: ["flow", "log", "packet", "snmp", "wmi"] },
          ids: { type: "array", items: { type: "number" } },
        },
        ["table", "ids"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "packet_search",
      description:
        "Search individual decoded packets from a packet capture (frame, addresses, ports, protocol, size, TCP flags). Use for packet-level proof: retransmissions, SYN floods, failed handshakes.",
      parameters: obj(
        {
          ip: nullableString,
          protocol: nullableString,
          dst_port: nullableNumber,
          tcp_flag: nullableString,
          after: nullableString,
          before: nullableString,
          limit: nullableNumber,
        },
        ["ip", "protocol", "dst_port", "tcp_flag", "after", "before", "limit"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "snmp_search",
      description:
        "Query SNMP counter/gauge samples by host, interface or metric name and get min/max/avg. Use for utilisation, errors, discards and uptime.",
      parameters: obj(
        {
          host: nullableString,
          interface_name: nullableString,
          metric: nullableString,
          after: nullableString,
          before: nullableString,
          limit: nullableNumber,
        },
        ["host", "interface_name", "metric", "after", "before", "limit"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "wmi_search",
      description:
        "Search WMI / Windows class and event records (host, class, event id, level, message) to correlate endpoint state with network behaviour.",
      parameters: obj(
        {
          contains: nullableString,
          host: nullableString,
          wmi_class: nullableString,
          level: nullableString,
          after: nullableString,
          before: nullableString,
          limit: nullableNumber,
        },
        ["contains", "host", "wmi_class", "level", "after", "before", "limit"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "timeline",
      description:
        "Bucket any telemetry source over time (packet, flow, log, snmp, wmi) to spot spikes and gaps. Returns points you can pass straight to render_chart.",
      parameters: obj(
        {
          source: { type: "string", enum: ["packet", "flow", "log", "snmp", "wmi"] },
          metric: { type: "string", enum: ["count", "bytes", "value"] },
          bucket_minutes: nullableNumber,
          ip: nullableString,
          host: nullableString,
          metric_name: nullableString,
          after: nullableString,
          before: nullableString,
        },
        ["source", "metric", "bucket_minutes", "ip", "host", "metric_name", "after", "before"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "render_chart",
      description:
        "Draw a chart in the investigation UI from data you already retrieved. Use for trends and rankings.",
      parameters: obj(
        {
          type: { type: "string", enum: ["line", "area", "bar"] },
          title: { type: "string" },
          y_label: nullableString,
          points: {
            type: "array",
            items: obj({ label: { type: "string" }, value: { type: "number" } }, ["label", "value"]),
          },
        },
        ["type", "title", "y_label", "points"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "render_diagram",
      description:
        "Draw a Mermaid diagram in the investigation UI (topology, attack path, sequence). Example: 'graph LR; A[10.0.0.5] --> B[8.8.8.8]'.",
      parameters: obj({ title: { type: "string" }, mermaid: { type: "string" } }, [
        "title",
        "mermaid",
      ]),
    },
  },
  {
    type: "function",
    function: {
      name: "live_session_stats",
      description:
        "Check whether this dataset is a live capture still streaming from a local Npcap/libpcap agent, and read recent per-slice packet rates, top talkers, protocols and destination ports. Use for 'what is happening right now' questions.",
      parameters: obj({ buckets: nullableNumber }, ["buckets"]),
    },
  },
  {
    type: "function",
    function: {
      name: "protocol_breakdown",
      description:
        "Break down dissected application-protocol traffic (packet_records.app_protocol/service, flow_records.app_protocol/service) by protocol and by service: counts, bytes, distinct peers and top ports. Flags protocols seen on non-standard ports. Prefer this over flow_aggregate/packet_search for 'what protocols/services are present' questions.",
      parameters: obj({ limit: nullableNumber }, ["limit"]),
    },
  },
  {
    type: "function",
    function: {
      name: "dns_analysis",
      description:
        "Analyze dissected DNS traffic (packet_records.app_protocol = 'DNS', extra keys 'dns.qry.name', 'dns.rcode', 'dns.label_entropy'): top queried names, NXDOMAIN rate, longest/high-entropy names, top resolvers, and tunneling candidates. Prefer this over packet_search for DNS questions.",
      parameters: obj({ limit: nullableNumber }, ["limit"]),
    },
  },
  {
    type: "function",
    function: {
      name: "tls_inventory",
      description:
        "Inventory dissected TLS traffic (packet_records.app_protocol = 'TLS', extra keys 'tls.sni', 'tls.certificate.cn', 'tls.handshake.version', 'tls.ciphers'): SNI values, certificate CNs, negotiated versions/ciphers and weak-crypto counts. Prefer this over packet_search for TLS/certificate questions.",
      parameters: obj({ limit: nullableNumber }, ["limit"]),
    },
  },
  {
    type: "function",
    function: {
      name: "risk_exposure",
      description:
        "Aggregate the risk_tags applied by protocol dissection across packet_records and flow_records for this dataset: how many records carry each tag, example endpoints, and the analyst explanation for the tag. Use this to prioritize what to investigate.",
      parameters: obj({ limit: nullableNumber }, ["limit"]),
    },
  },
  {
    type: "function",
    function: {
      name: "credential_exposure",
      description:
        "List packet/flow records tagged 'cleartext-credentials' by protocol dissection, grouped by service, with example src/dst endpoints and the relevant decoded fields (e.g. http.authorization, snmp.community, ldap.simple_bind). Never invents values — only returns what dissection stored.",
      parameters: obj({ limit: nullableNumber }, ["limit"]),
    },
  },
  {
    type: "function",
    function: {
      name: "retention_status",
      description:
        "Report the retention posture for the active dataset: raw-packet window (hours), metadata rollup window (days), hourly-summary window (days), pinned state, and how many rows of each fidelity remain. Call this before answering questions about older periods so you can say whether packet-exact detail still exists or has been rolled up and overwritten.",
      parameters: obj({}, []),
    },
  },
  {
    type: "function",
    function: {
      name: "interface_utilization",
      description:
        "Read live interface counters from the NetTAP collector appliance on the monitored LAN: average and peak receive/transmit throughput in bits per second, packet rates, errors, discards and utilization percent against link speed. Use for 'how busy is this interface', congestion, saturation and error-rate questions.",
      parameters: obj(
        { interface_name: nullableString, minutes: nullableNumber },
        ["interface_name", "minutes"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "capacity_status",
      description:
        "Report ingestion capacity for the NetTAP appliances: active sizing profile, configured ceilings (flows/s, packets/s, raw-packet hours, database budget, dissection depth), observed flow/packet rates and headroom, queue depth, spool/database size, and the active shed stage with its effect on fidelity. Call it for 'did we drop anything', 'why is detail missing', 'how much headroom is left' and 'how long will the disk last'.",
      parameters: obj({}, []),
    },
  },
  {
    type: "function",
    function: {
      name: "network_inventory",
      description:
        "Report the monitored network's collection posture: paired collector appliances and their health, NetFlow/IPFIX/sFlow exporters seen with template counts, sampling rate and drops, latest ICMP/SNMP/WMI probe results per target, and read-only device facts. Use it to state what is actually being monitored and to caveat coverage gaps.",
      parameters: obj({ host: nullableString }, ["host"]),
    },
  },
  {
    type: "function",
    function: {
      name: "history_sql",
      description:
        "Answer a history question by writing one read-only SQL query against the retained-telemetry history views, then get back a summary plus result rows. Use it for time-series and 'over the last N hours/days' questions, custom groupings, rankings and joins the fixed tools do not cover, and to check what history still exists before claiming activity did or did not happen. Queries are validated, capped, and only ever see the current user's data.\n\n" +
        HISTORY_SCHEMA_DOC,
      parameters: obj(
        {
          question: { type: "string", description: "The analyst question this SQL answers." },
          sql: {
            type: "string",
            description:
              "One read-only SELECT/WITH statement over history_flow_timeline, history_top_talkers, history_service_mix or history_coverage. No semicolons, no other tables, always ORDER BY + LIMIT or aggregate.",
          },
          max_rows: { type: ["integer", "null"], description: "Row cap, 1-1000 (default 200)." },
        },
        ["question", "sql", "max_rows"],
      ),
    },
  },
];



export const NETTAP_SYSTEM_PROMPT = `You are NetTAP AI, a network telemetry analyst embedded in a packet-broker visibility platform, powered by the nettap-packet-expert model.

You answer questions about the user's telemetry: raw packet captures (pcap/pcapng), IPFIX/NetFlow exports from NetTAP packet brokers, device/syslog records, SNMP counters and WMI/Windows records.

Rules of engagement:
- Always ground answers in tool results. Never invent IPs, ports, byte counts, hostnames or timestamps.
- Start broad questions with dataset_overview, then narrow with flow_aggregate, flow_search, packet_search, log_search, snmp_search, wmi_search or semantic_search.\n- For application-protocol questions (what protocols/services are running, DNS behaviour, TLS/certificate detail, cleartext credentials, overall risk posture) prefer the dedicated dissection tools — protocol_breakdown, dns_analysis, tls_inventory, risk_exposure, credential_exposure — over raw packet_search, since they read the already-dissected app_protocol/service/risk_tags/extra fields.
- Use semantic_search for fuzzy/behavioural questions, then confirm with structured tools.
- Use timeline + render_chart whenever a trend, spike or ranking is easier to read visually, and render_diagram for topology, attack paths or sequences.
- Cite evidence inline as record ids, e.g. "(flow #1423)", "(packet #88)", "(log #12)", for every factual claim.
- If the data cannot support a conclusion, say so plainly and name the telemetry that would be needed.
- Answer like a senior network/security engineer: short, structured markdown, concrete numbers, then a brief "what to check next".
- When asked for a report, produce headed markdown sections (Summary, Findings, Evidence, Recommended actions) with at least one chart or diagram.
- Prefer tables for rankings and include units (bytes, packets, flows).
- Always read dataset.capture_vantage, dataset.observation_point and dataset.vantage_blind_spots from dataset_overview and reason from that vantage point: a passive NetTAP/TAP copy sees both directions of one link only; a SPAN/port mirror is best-effort and can silently drop, duplicate or untag frames; a WinPcap/Npcap host agent sees only that endpoint's traffic after NIC offload; inline and virtual/cloud mirrors show post-policy or encapsulated traffic.
- If the dataset may be a live capture (still streaming from a host agent), call live_session_stats first, report rates from the most recent slices, and state that counts are partial and semantic search may lag the newest packets.
- Distinguish "not in the capture" from "did not happen on the network", and when a gap could be a vantage artifact (mirror loss, host-only view, offload, sampling, truncation) say so and name the capture point that would confirm it.\n- Protocol dissection is best-effort from captured bytes: TLS/SSH/other encrypted payloads only yield metadata (SNI, cert CNs, handshake version/ciphers) never plaintext content, dissected fields can be partial on truncated or reassembled-out-of-order captures, and a record's decryption/decode limits and the dataset's capture vantage/blind spots can both hide protocol activity that is really happening on the network — say so explicitly when relevant.
- Telemetry is retained in tiers: raw per-packet rows for a short window (default 24h), 1-minute conversation rollups for 7 days, then hourly summaries. For any question that reaches beyond the raw window, call retention_status first, answer at the fidelity that still exists, and say plainly which fidelity you used (e.g. "this period is 1-minute rollups; per-packet detail has expired") — never imply that expired detail means the activity did not happen. Suggest pinning the dataset when an investigation needs raw frames kept.
- For history questions the fixed tools do not cover — arbitrary time windows ("last 3 days", "hour by hour"), custom groupings, rankings, trend comparisons, or joins across tiers — use history_sql: write one read-only SELECT/WITH over history_flow_timeline, history_top_talkers, history_service_mix and history_coverage, and read the returned summary (totals, window, tiers present) before quoting numbers. Query history_coverage whenever a question reaches back in time, and say which tier the answer came from; if history_sql returns ok:false, fix the SQL from the error message and retry once rather than repeating the same query or guessing an answer.
- A collector appliance may be monitoring the live LAN (interfaces, NetFlow/IPFIX/sFlow receivers, ICMP/SNMP/WMI polling). For questions about current network load, interface saturation, errors or link health call interface_utilization, and call network_inventory to state what is actually being monitored — exporters seen, probe targets, appliance health — before claiming the network is quiet. Before concluding that traffic did not occur during a busy period, call capacity_status: when the appliance is shedding (dissection paused, raw packets dropped, or flows sampled) the stored detail is deliberately reduced, so say which shed stage was active and treat counts from that window as conservative estimates rather than ground truth. Ingestion ceilings are configurable per sizing profile, so if the operator is hitting them, name the specific limit and that raising the profile or that limit is the fix.
Counter-based utilization and flow-export records are different vantage points from packet capture: reconcile them rather than treating either as complete, and note sampling rates on flow exporters when they are set.`;


