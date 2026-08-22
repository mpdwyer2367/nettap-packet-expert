/**
 * Server-side query + build logic for report playbooks. Queries datasets
 * directly (no AI tool calls needed — these are deterministic reports) and
 * returns markdown + visuals in the same shape the chat report builder uses.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ReportVisual } from "@/lib/reports.functions";
import { renderVisualsMarkdown } from "@/lib/report-builder";
import { RISK_TAG_NOTES } from "@/lib/dissect";
import type { ReportPlaybookId } from "@/lib/report-playbooks";

type Client = SupabaseClient<Database>;
type FlowRow = Database["public"]["Tables"]["flow_records"]["Row"];
type PacketRow = Database["public"]["Tables"]["packet_records"]["Row"];
type DatasetRow = Database["public"]["Tables"]["datasets"]["Row"];

const MAX_SCAN = 20000;

export type PlaybookResult = {
  title: string;
  markdown: string;
  visuals: ReportVisual[];
};

function extraField(extra: unknown, key: string): string | null {
  if (!extra || typeof extra !== "object") return null;
  const value = (extra as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function bucketTime(ts: string | null, granularityMs: number) {
  if (!ts) return "unknown";
  const time = new Date(ts).getTime();
  if (Number.isNaN(time)) return "unknown";
  const bucket = Math.floor(time / granularityMs) * granularityMs;
  return new Date(bucket).toISOString().slice(0, 19).replace("T", " ");
}

function topEntries<T>(map: Map<T, number>, limit: number) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

async function loadDataset(supabase: Client, datasetId: string): Promise<DatasetRow> {
  const { data, error } = await supabase.from("datasets").select("*").eq("id", datasetId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Dataset not found.");
  return data;
}

async function loadFlows(supabase: Client, datasetId: string): Promise<FlowRow[]> {
  const { data, error } = await supabase
    .from("flow_records")
    .select("*")
    .eq("dataset_id", datasetId)
    .limit(MAX_SCAN);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadPackets(supabase: Client, datasetId: string): Promise<PacketRow[]> {
  const { data, error } = await supabase
    .from("packet_records")
    .select("*")
    .eq("dataset_id", datasetId)
    .limit(MAX_SCAN);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Unified "conversation" view over whichever record kind the dataset holds. */
type Conversation = {
  ts: string | null;
  src: string | null;
  dst: string | null;
  protocol: string | null;
  app_protocol: string | null;
  service: string | null;
  risk_tags: string[];
  bytes: number;
  flags: string | null;
  extra: unknown;
};

function conversationsFromFlows(rows: FlowRow[]): Conversation[] {
  return rows.map((row) => ({
    ts: row.ts,
    src: row.src_ip ? `${row.src_ip}${row.src_port ? `:${row.src_port}` : ""}` : null,
    dst: row.dst_ip ? `${row.dst_ip}${row.dst_port ? `:${row.dst_port}` : ""}` : null,
    protocol: row.protocol,
    app_protocol: row.app_protocol,
    service: row.service,
    risk_tags: row.risk_tags ?? [],
    bytes: row.bytes ?? 0,
    flags: row.flags,
    extra: row.extra,
  }));
}

function conversationsFromPackets(rows: PacketRow[]): Conversation[] {
  return rows.map((row) => ({
    ts: row.ts,
    src: row.src_ip ? `${row.src_ip}${row.src_port ? `:${row.src_port}` : ""}` : null,
    dst: row.dst_ip ? `${row.dst_ip}${row.dst_port ? `:${row.dst_port}` : ""}` : null,
    protocol: row.protocol,
    app_protocol: row.app_protocol,
    service: row.service,
    risk_tags: row.risk_tags ?? [],
    bytes: row.length ?? 0,
    flags: row.tcp_flags,
    extra: row.extra,
  }));
}

async function loadConversations(supabase: Client, dataset: DatasetRow): Promise<Conversation[]> {
  if (dataset.kind === "packet") {
    const packets = await loadPackets(supabase, dataset.id);
    if (packets.length) return conversationsFromPackets(packets);
  }
  const flows = await loadFlows(supabase, dataset.id);
  if (flows.length) return conversationsFromFlows(flows);
  const packets = await loadPackets(supabase, dataset.id);
  return conversationsFromPackets(packets);
}

function header(title: string, dataset: DatasetRow) {
  return [
    `# ${title}`,
    "",
    `- **Dataset:** ${dataset.name}`,
    `- **Kind:** ${dataset.kind}`,
    `- **Records:** ${dataset.record_count}`,
    `- **Range:** ${dataset.range_start ?? "?"} → ${dataset.range_end ?? "?"}`,
    `- **Vantage:** ${dataset.vantage}${dataset.observation_point ? ` (${dataset.observation_point})` : ""}`,
    `- **Generated:** ${new Date().toISOString()}`,
    "",
  ];
}

/* --------------------------------------------------------- triage_summary */

async function buildTriageSummary(supabase: Client, dataset: DatasetRow): Promise<PlaybookResult> {
  const conversations = await loadConversations(supabase, dataset);
  const talkers = new Map<string, number>();
  const protocols = new Map<string, number>();
  let totalBytes = 0;
  const topPairs = new Map<string, number>();

  for (const c of conversations) {
    totalBytes += c.bytes;
    if (c.src) talkers.set(c.src, (talkers.get(c.src) ?? 0) + c.bytes);
    const protocol = c.app_protocol ?? c.protocol ?? "unknown";
    protocols.set(protocol, (protocols.get(protocol) ?? 0) + 1);
    if (c.src && c.dst) {
      const key = `${c.src} -> ${c.dst}`;
      topPairs.set(key, (topPairs.get(key) ?? 0) + c.bytes);
    }
  }

  const topTalkers = topEntries(talkers, 10);
  const topProtocols = topEntries(protocols, 10);
  const topConversations = topEntries(topPairs, 8);

  const lines = [
    ...header("Triage summary", dataset),
    "## Traffic overview",
    "",
    `- **Records analyzed:** ${conversations.length}`,
    `- **Total bytes:** ${totalBytes.toLocaleString()}`,
    "",
    "## Top talkers (by bytes)",
    "",
    "| Host | Bytes |",
    "| --- | --- |",
    ...topTalkers.map(([host, bytes]) => `| ${host} | ${bytes.toLocaleString()} |`),
    "",
    "## Protocol mix",
    "",
    "| Protocol | Count |",
    "| --- | --- |",
    ...topProtocols.map(([protocol, count]) => `| ${protocol} | ${count} |`),
    "",
  ];

  const visuals: ReportVisual[] = [
    {
      type: "chart",
      title: "Top talkers by bytes",
      chartType: "bar",
      points: topTalkers.map(([label, value]) => ({ label, value })),
    },
    {
      type: "chart",
      title: "Protocol mix",
      chartType: "bar",
      points: topProtocols.map(([label, value]) => ({ label, value })),
    },
  ];

  if (topConversations.length) {
    const mermaidLines = ["graph LR"];
    topConversations.forEach(([pair, bytes], index) => {
      const [src, dst] = pair.split(" -> ");
      mermaidLines.push(`  N${index}0["${src ?? "?"}"] -->|${bytes.toLocaleString()}B| N${index}1["${dst ?? "?"}"]`);
    });
    visuals.push({ type: "diagram", title: "Top conversations", mermaid: mermaidLines.join("\n") });
  }

  lines.push(...renderVisualsMarkdown(visuals));
  return { title: "Triage summary", markdown: lines.join("\n"), visuals };
}

/* ------------------------------------------------------ security_exposure */

async function buildSecurityExposure(supabase: Client, dataset: DatasetRow): Promise<PlaybookResult> {
  const conversations = await loadConversations(supabase, dataset);
  const tagCounts = new Map<string, number>();
  const flagged: Conversation[] = [];

  for (const c of conversations) {
    for (const tag of c.risk_tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
    if (c.risk_tags.length) flagged.push(c);
  }

  const cleartext = flagged.filter((c) => c.risk_tags.includes("cleartext-credentials"));
  const remoteAdmin = flagged.filter((c) => c.risk_tags.includes("remote-admin"));
  const legacy = flagged.filter((c) => c.risk_tags.includes("legacy-protocol"));
  const topTags = topEntries(tagCounts, 15);

  const lines = [
    ...header("Security exposure", dataset),
    "## Risk tag summary",
    "",
    "| Risk tag | Occurrences | Notes |",
    "| --- | --- | --- |",
    ...topTags.map(([tag, count]) => `| ${tag} | ${count} | ${(RISK_TAG_NOTES[tag] ?? "").replace(/\|/g, "/")} |`),
    "",
    "## Cleartext credentials",
    "",
    ...(cleartext.length
      ? [
          "| Time | Source | Destination | Service |",
          "| --- | --- | --- | --- |",
          ...cleartext.slice(0, 40).map((c) => `| ${c.ts ?? "-"} | ${c.src ?? "-"} | ${c.dst ?? "-"} | ${c.service ?? c.app_protocol ?? "-"} |`),
        ]
      : ["_None observed._"]),
    "",
    "## Remote administration surface",
    "",
    ...(remoteAdmin.length
      ? [
          "| Time | Source | Destination | Service |",
          "| --- | --- | --- | --- |",
          ...remoteAdmin.slice(0, 40).map((c) => `| ${c.ts ?? "-"} | ${c.src ?? "-"} | ${c.dst ?? "-"} | ${c.service ?? c.app_protocol ?? "-"} |`),
        ]
      : ["_None observed._"]),
    "",
    "## Legacy protocols",
    "",
    ...(legacy.length
      ? [
          "| Time | Source | Destination | Service |",
          "| --- | --- | --- | --- |",
          ...legacy.slice(0, 40).map((c) => `| ${c.ts ?? "-"} | ${c.src ?? "-"} | ${c.dst ?? "-"} | ${c.service ?? c.app_protocol ?? "-"} |`),
        ]
      : ["_None observed._"]),
    "",
  ];

  const visuals: ReportVisual[] = [
    {
      type: "chart",
      title: "Risk tags by occurrence",
      chartType: "bar",
      points: topTags.map(([label, value]) => ({ label, value })),
    },
  ];
  lines.push(...renderVisualsMarkdown(visuals));
  return { title: "Security exposure", markdown: lines.join("\n"), visuals };
}

/* ----------------------------------------------------- dns_investigation */

async function buildDnsInvestigation(supabase: Client, dataset: DatasetRow): Promise<PlaybookResult> {
  const conversations = await loadConversations(supabase, dataset);
  const dns = conversations.filter((c) => (c.app_protocol ?? c.service) === "DNS");

  const volumeBuckets = new Map<string, number>();
  let nxdomain = 0;
  const tunnelCandidates: { ts: string | null; name: string | null; note: string }[] = [];

  for (const record of dns) {
    const bucket = bucketTime(record.ts, 60_000);
    volumeBuckets.set(bucket, (volumeBuckets.get(bucket) ?? 0) + 1);
    const name = extraField(record.extra, "dns.qry.name");
    if (extraField(record.extra, "dns.nxdomain") === "true") nxdomain += 1;
    const tunnelFlag = extraField(record.extra, "dns.tunnel_candidate");
    const entropy = extraField(record.extra, "dns.label_entropy");
    if (tunnelFlag === "true" || (entropy && Number(entropy) >= 3.6)) {
      tunnelCandidates.push({
        ts: record.ts,
        name,
        note: tunnelFlag === "true" ? "TXT/NULL record" : `high label entropy (${entropy})`,
      });
    }
  }

  const sortedVolume = [...volumeBuckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const lines = [
    ...header("DNS investigation", dataset),
    "## Query volume",
    "",
    `- **Total DNS records:** ${dns.length}`,
    `- **NXDOMAIN responses:** ${nxdomain}`,
    "",
    "## Tunneling candidates",
    "",
    ...(tunnelCandidates.length
      ? [
          "| Time | Name | Reason |",
          "| --- | --- | --- |",
          ...tunnelCandidates.slice(0, 40).map((t) => `| ${t.ts ?? "-"} | ${t.name ?? "-"} | ${t.note} |`),
        ]
      : ["_No tunneling indicators found._"]),
    "",
  ];

  const visuals: ReportVisual[] = [
    {
      type: "chart",
      title: "DNS query volume over time",
      chartType: "line",
      points: sortedVolume.map(([label, value]) => ({ label, value })),
    },
  ];
  lines.push(...renderVisualsMarkdown(visuals));
  return { title: "DNS investigation", markdown: lines.join("\n"), visuals };
}

/* ----------------------------------------------------- encrypted_traffic */

async function buildEncryptedTraffic(supabase: Client, dataset: DatasetRow): Promise<PlaybookResult> {
  const conversations = await loadConversations(supabase, dataset);
  const tls = conversations.filter((c) => (c.app_protocol ?? c.service) === "TLS");

  const versions = new Map<string, number>();
  const sniHosts = new Map<string, number>();
  const certCns = new Set<string>();

  for (const record of tls) {
    const version = extraField(record.extra, "tls.handshake.version") ?? extraField(record.extra, "tls.record.version");
    if (version) versions.set(version, (versions.get(version) ?? 0) + 1);
    const sni = extraField(record.extra, "tls.sni");
    if (sni) sniHosts.set(sni, (sniHosts.get(sni) ?? 0) + 1);
    const cn = extraField(record.extra, "tls.certificate.cn");
    if (cn) for (const value of cn.split(",")) certCns.add(value.trim());
  }

  const topSni = topEntries(sniHosts, 20);
  const versionEntries = topEntries(versions, 10);
  const decryptionSummary = dataset.decryption_summary;

  const lines = [
    ...header("Encrypted traffic", dataset),
    "## TLS handshakes observed",
    "",
    `- **TLS records:** ${tls.length}`,
    "",
    "## TLS versions",
    "",
    "| Version | Count |",
    "| --- | --- |",
    ...versionEntries.map(([version, count]) => `| ${version} | ${count} |`),
    "",
    "## Server names (SNI)",
    "",
    ...(topSni.length
      ? ["| Host | Handshakes |", "| --- | --- |", ...topSni.map(([host, count]) => `| ${host} | ${count} |`)]
      : ["_No SNI observed._"]),
    "",
    "## Certificate common names",
    "",
    ...(certCns.size ? [...certCns].slice(0, 40).map((cn) => `- ${cn}`) : ["_No certificates decoded._"]),
    "",
    "## Decryption coverage",
    "",
    "```json",
    JSON.stringify(decryptionSummary ?? {}, null, 2),
    "```",
    "",
  ];

  const visuals: ReportVisual[] = [
    {
      type: "chart",
      title: "TLS versions negotiated",
      chartType: "bar",
      points: versionEntries.map(([label, value]) => ({ label, value })),
    },
  ];
  lines.push(...renderVisualsMarkdown(visuals));
  return { title: "Encrypted traffic", markdown: lines.join("\n"), visuals };
}

/* ---------------------------------------------------- performance_health */

async function buildPerformanceHealth(supabase: Client, dataset: DatasetRow): Promise<PlaybookResult> {
  const conversations = await loadConversations(supabase, dataset);

  let retransmits = 0;
  let resets = 0;
  const pairBytes = new Map<string, number>();
  const throughputBuckets = new Map<string, number>();

  for (const c of conversations) {
    const flags = (c.flags ?? "").toUpperCase();
    if (flags.includes("R")) resets += 1;
    if (extraField(c.extra, "tcp.analysis.retransmission") === "true") retransmits += 1;
    if (c.src && c.dst) {
      const key = `${c.src} -> ${c.dst}`;
      pairBytes.set(key, (pairBytes.get(key) ?? 0) + c.bytes);
    }
    const bucket = bucketTime(c.ts, 60_000);
    throughputBuckets.set(bucket, (throughputBuckets.get(bucket) ?? 0) + c.bytes);
  }

  const topConversations = topEntries(pairBytes, 15);
  const sortedThroughput = [...throughputBuckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const lines = [
    ...header("Performance health", dataset),
    "## Signal summary",
    "",
    `- **RST flags observed:** ${resets}`,
    `- **Retransmission markers:** ${retransmits}`,
    "",
    "## Top conversations by bytes",
    "",
    "| Conversation | Bytes |",
    "| --- | --- |",
    ...topConversations.map(([pair, bytes]) => `| ${pair} | ${bytes.toLocaleString()} |`),
    "",
  ];

  const visuals: ReportVisual[] = [
    {
      type: "chart",
      title: "Top conversations by bytes",
      chartType: "bar",
      points: topConversations.map(([label, value]) => ({ label, value })),
    },
    {
      type: "chart",
      title: "Throughput over time",
      chartType: "line",
      points: sortedThroughput.map(([label, value]) => ({ label, value })),
    },
  ];
  lines.push(...renderVisualsMarkdown(visuals));
  return { title: "Performance health", markdown: lines.join("\n"), visuals };
}

export async function runReportPlaybook(
  supabase: Client,
  datasetId: string,
  playbook: ReportPlaybookId,
): Promise<PlaybookResult> {
  const dataset = await loadDataset(supabase, datasetId);
  switch (playbook) {
    case "triage_summary":
      return buildTriageSummary(supabase, dataset);
    case "security_exposure":
      return buildSecurityExposure(supabase, dataset);
    case "dns_investigation":
      return buildDnsInvestigation(supabase, dataset);
    case "encrypted_traffic":
      return buildEncryptedTraffic(supabase, dataset);
    case "performance_health":
      return buildPerformanceHealth(supabase, dataset);
    default:
      throw new Error(`Unknown playbook: ${playbook satisfies never}`);
  }
}
