import Papa from "papaparse";
import {
  looksLikeSnmpCsv,
  looksLikeWmiCsv,
  parseSnmpCsv,
  parseWmiCsv,
  type ParsedSnmp,
  type ParsedWmi,
} from "./telemetry-extra";

export type DatasetKind = "flow" | "log" | "packet" | "snmp" | "wmi";


export type ParsedFlow = {
  ts: string | null;
  src_ip: string | null;
  dst_ip: string | null;
  src_port: number | null;
  dst_port: number | null;
  protocol: string | null;
  bytes: number;
  packets: number;
  flags: string | null;
  observation_point: string | null;
  extra: Record<string, string>;
};

export type ParsedLog = {
  ts: string | null;
  host: string | null;
  severity: string | null;
  message: string;
  extra: Record<string, string>;
};

export type ParseResult =
  | { kind: "flow"; flows: ParsedFlow[]; skipped: number }
  | { kind: "log"; logs: ParsedLog[]; skipped: number }
  | { kind: "snmp"; snmp: ParsedSnmp[]; skipped: number }
  | { kind: "wmi"; wmi: ParsedWmi[]; skipped: number };


export const MAX_RECORDS = 20000;

const FIELD_ALIASES: Record<keyof Omit<ParsedFlow, "extra">, string[]> = {
  ts: [
    "ts",
    "timestamp",
    "time",
    "date",
    "first_switched",
    "firstseen",
    "first_seen",
    "flowstart",
    "flow_start",
    "starttime",
    "start_time",
    "datefirstseen",
  ],
  src_ip: [
    "src_ip",
    "srcip",
    "source_ip",
    "sourceipv4address",
    "sourceaddress",
    "src_addr",
    "srcaddr",
    "source",
    "src",
    "ipv4_src_addr",
  ],
  dst_ip: [
    "dst_ip",
    "dstip",
    "destination_ip",
    "destinationipv4address",
    "destinationaddress",
    "dst_addr",
    "dstaddr",
    "destination",
    "dst",
    "ipv4_dst_addr",
  ],
  src_port: [
    "src_port",
    "srcport",
    "source_port",
    "sourcetransportport",
    "sport",
    "l4_src_port",
  ],
  dst_port: [
    "dst_port",
    "dstport",
    "destination_port",
    "destinationtransportport",
    "dport",
    "l4_dst_port",
  ],
  protocol: ["protocol", "proto", "protocolidentifier", "ip_protocol", "service"],
  bytes: [
    "bytes",
    "in_bytes",
    "octets",
    "octetdeltacount",
    "bytes_total",
    "totalbytes",
    "byte_count",
    "length",
    "len",
  ],
  packets: [
    "packets",
    "in_pkts",
    "pkts",
    "packetdeltacount",
    "packet_count",
    "total_packets",
  ],
  flags: ["flags", "tcp_flags", "tcpcontrolbits", "info"],
  observation_point: [
    "observation_point",
    "exporter",
    "exporter_ip",
    "device",
    "tap",
    "interface",
    "in_iface",
    "input_snmp",
    "broker",
    "port",
  ],
};

const PROTOCOL_NUMBERS: Record<string, string> = {
  "1": "ICMP",
  "6": "TCP",
  "17": "UDP",
  "47": "GRE",
  "50": "ESP",
  "58": "ICMPv6",
  "132": "SCTP",
};

const SYSLOG_SEVERITIES = [
  "emerg",
  "emergency",
  "alert",
  "crit",
  "critical",
  "err",
  "error",
  "warn",
  "warning",
  "notice",
  "info",
  "informational",
  "debug",
];

/** Flow fields an analyst can map CSV columns onto before ingest. */
export type FlowFieldKey =
  | "ts"
  | "src_ip"
  | "dst_ip"
  | "src_port"
  | "dst_port"
  | "protocol"
  | "bytes"
  | "packets"
  | "flags"
  | "observation_point";

export type FlowColumnMapping = Partial<Record<FlowFieldKey, string>>;

export const FLOW_FIELDS: { key: FlowFieldKey; label: string; hint: string }[] = [
  { key: "ts", label: "Timestamp", hint: "ISO date, epoch seconds or epoch milliseconds" },
  { key: "src_ip", label: "Source IP", hint: "Required — rows without a source or destination are skipped" },
  { key: "dst_ip", label: "Destination IP", hint: "Required — rows without a source or destination are skipped" },
  { key: "src_port", label: "Source port", hint: "0-65535" },
  { key: "dst_port", label: "Destination port", hint: "0-65535" },
  { key: "protocol", label: "Protocol", hint: "Name or IP protocol number (6 = TCP, 17 = UDP)" },
  { key: "bytes", label: "Bytes", hint: "Octet count for the flow" },
  { key: "packets", label: "Packets", hint: "Packet count for the flow" },
  { key: "flags", label: "TCP flags / info", hint: "TCP control bits or summary text" },
  { key: "observation_point", label: "Observation point", hint: "Exporter, TAP, broker port or interface" },
];

export function normalizeTelemetryHeader(header: string) {
  return normalizeHeader(header);
}

/** Best-guess mapping used to prefill the editable CSV mapping step. */
export function suggestFlowMapping(headers: string[]): FlowColumnMapping {
  const normalized = headers.map((header) => normalizeHeader(header));
  const mapping: FlowColumnMapping = {};
  for (const field of FLOW_FIELDS) {
    const match = pickColumn(normalized, FIELD_ALIASES[field.key]);
    if (match) mapping[field.key] = match;
  }
  return mapping;
}

function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/[\s\-.]+/g, "_");
}

function pickColumn(headers: string[], aliases: string[]) {
  for (const alias of aliases) {
    const match = headers.find((header) => header === alias);
    if (match) return match;
  }
  for (const alias of aliases) {
    const match = headers.find((header) => header.includes(alias));
    if (match) return match;
  }
  return undefined;
}

function toNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/[^0-9.eE+-]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function toPort(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : null;
}

function toTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000).toISOString();
  if (/^\d{13}$/.test(raw)) return new Date(Number(raw)).toISOString();

  const parsed = new Date(raw.includes(" ") && !raw.includes("T") ? raw.replace(" ", "T") : raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return null;
}

function normalizeProtocol(value: string | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  return PROTOCOL_NUMBERS[raw] ?? raw.toUpperCase();
}

function looksLikeFlowCsv(headers: string[]) {
  const hasSrc = Boolean(pickColumn(headers, FIELD_ALIASES.src_ip));
  const hasDst = Boolean(pickColumn(headers, FIELD_ALIASES.dst_ip));
  return hasSrc && hasDst;
}

/** Parses CSV telemetry (IPFIX/NetFlow exports, PCAP summary CSV) into flow records. */
function parseFlowCsv(
  rows: Record<string, string>[],
  headers: string[],
  mapping?: FlowColumnMapping,
): ParseResult {
  // An explicit mapping from the ingest UI always wins over alias detection;
  // an empty string means "ignore this field".
  const resolve = (key: FlowFieldKey) => {
    if (mapping && key in mapping) {
      const chosen = mapping[key];
      if (!chosen) return undefined;
      return headers.includes(chosen) ? chosen : normalizeHeader(chosen);
    }
    return pickColumn(headers, FIELD_ALIASES[key]);
  };

  const columns = {
    ts: resolve("ts"),
    src_ip: resolve("src_ip"),
    dst_ip: resolve("dst_ip"),
    src_port: resolve("src_port"),
    dst_port: resolve("dst_port"),
    protocol: resolve("protocol"),
    bytes: resolve("bytes"),
    packets: resolve("packets"),
    flags: resolve("flags"),
    observation_point: resolve("observation_point"),
  };

  const mapped = Object.values(columns).filter(Boolean) as string[];
  const flows: ParsedFlow[] = [];
  let skipped = 0;

  for (const row of rows.slice(0, MAX_RECORDS)) {
    const src = columns.src_ip ? row[columns.src_ip]?.trim() || null : null;
    const dst = columns.dst_ip ? row[columns.dst_ip]?.trim() || null : null;
    if (!src && !dst) {
      skipped += 1;
      continue;
    }

    const extra: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (mapped.includes(key)) continue;
      const trimmed = (value ?? "").toString().trim();
      if (trimmed) extra[key] = trimmed.slice(0, 200);
    }

    flows.push({
      ts: toTimestamp(columns.ts ? row[columns.ts] : undefined),
      src_ip: src,
      dst_ip: dst,
      src_port: toPort(columns.src_port ? row[columns.src_port] : undefined),
      dst_port: toPort(columns.dst_port ? row[columns.dst_port] : undefined),
      protocol: normalizeProtocol(columns.protocol ? row[columns.protocol] : undefined),
      bytes: toNumber(columns.bytes ? row[columns.bytes] : undefined),
      packets: toNumber(columns.packets ? row[columns.packets] : undefined) || 1,
      flags: columns.flags ? row[columns.flags]?.trim().slice(0, 120) || null : null,
      observation_point: columns.observation_point
        ? row[columns.observation_point]?.trim().slice(0, 120) || null
        : null,
      extra,
    });
  }

  return { kind: "flow", flows, skipped };
}

function parseLogCsv(rows: Record<string, string>[], headers: string[]): ParseResult {
  const tsColumn = pickColumn(headers, FIELD_ALIASES.ts);
  const hostColumn = pickColumn(headers, ["host", "hostname", "device", "source", "node"]);
  const severityColumn = pickColumn(headers, ["severity", "level", "priority", "facility"]);
  const messageColumn = pickColumn(headers, ["message", "msg", "text", "event", "description"]);

  const logs: ParsedLog[] = [];
  let skipped = 0;

  for (const row of rows.slice(0, MAX_RECORDS)) {
    const message = messageColumn
      ? (row[messageColumn] ?? "").trim()
      : Object.entries(row)
          .map(([key, value]) => `${key}=${value}`)
          .join(" ");
    if (!message) {
      skipped += 1;
      continue;
    }

    const extra: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if ([tsColumn, hostColumn, severityColumn, messageColumn].includes(key)) continue;
      const trimmed = (value ?? "").toString().trim();
      if (trimmed) extra[key] = trimmed.slice(0, 200);
    }

    logs.push({
      ts: toTimestamp(tsColumn ? row[tsColumn] : undefined),
      host: hostColumn ? row[hostColumn]?.trim() || null : null,
      severity: severityColumn ? row[severityColumn]?.trim().toLowerCase() || null : null,
      message: message.slice(0, 2000),
      extra,
    });
  }

  return { kind: "log", logs, skipped };
}

/** Parses free-form syslog / device log text, one event per line. */
function parseLogText(text: string): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_RECORDS);

  const logs: ParsedLog[] = lines.map((line) => {
    const isoMatch = line.match(
      /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/,
    );
    const syslogMatch = line.match(/^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/);
    const stamp = isoMatch?.[1] ?? syslogMatch?.[1] ?? undefined;
    const rest = stamp ? line.slice(stamp.length).trim() : line;
    const tokens = rest.split(/\s+/);
    const host = tokens[0] && /^[\w.:-]+$/.test(tokens[0]) ? tokens[0] : null;
    const lowered = line.toLowerCase();
    const severity = SYSLOG_SEVERITIES.find((level) => lowered.includes(level)) ?? null;

    return {
      ts: toTimestamp(
        stamp && syslogMatch && !isoMatch
          ? `${new Date().getUTCFullYear()} ${stamp} UTC`
          : stamp,
      ),
      host,
      severity,
      message: line.slice(0, 2000),
      extra: {},
    };
  });

  return { kind: "log", logs, skipped: 0 };
}

export function parseTelemetry(
  fileName: string,
  text: string,
  hint?: DatasetKind,
  mapping?: FlowColumnMapping,
): ParseResult {
  const isCsvLike = /\.(csv|tsv|txt)$/i.test(fileName) || text.includes(",");
  const looksTabular = (() => {
    if (!isCsvLike) return false;
    const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
    return firstLine.split(/[,;\t]/).length >= 3;
  })();

  if (!looksTabular) return parseLogText(text);

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
    dynamicTyping: false,
  });

  const rows = (parsed.data ?? []).filter((row) => row && typeof row === "object");
  const headers = (parsed.meta?.fields ?? []).map((field) => field ?? "");
  if (rows.length === 0) return parseLogText(text);

  const hasMapping = Boolean(mapping && (mapping.src_ip || mapping.dst_ip));

  const kind: DatasetKind = hasMapping
    ? "flow"
    : hint && hint !== "packet"
      ? hint
      : looksLikeSnmpCsv(headers)
        ? "snmp"
        : looksLikeWmiCsv(headers)
          ? "wmi"
          : looksLikeFlowCsv(headers)
            ? "flow"
            : "log";

  if (kind === "snmp") return parseSnmpCsv(rows, headers);
  if (kind === "wmi") return parseWmiCsv(rows, headers);
  return kind === "flow" ? parseFlowCsv(rows, headers, mapping) : parseLogCsv(rows, headers);
}


export function summarizeRange(timestamps: (string | null)[]) {
  const valid = timestamps.filter((value): value is string => Boolean(value)).sort();
  return { start: valid[0] ?? null, end: valid[valid.length - 1] ?? null };
}

/**
 * Builds compact text chunks for semantic search: flows are grouped by
 * conversation pair, logs by consecutive batches.
 */
export function buildFlowChunks(
  flows: (ParsedFlow & { id: number })[],
  maxChunks = 160,
): { kind: string; content: string; record_ids: number[] }[] {
  const groups = new Map<string, (ParsedFlow & { id: number })[]>();
  for (const flow of flows) {
    const key = `${flow.src_ip ?? "?"}|${flow.dst_ip ?? "?"}|${flow.protocol ?? "?"}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(flow);
    else groups.set(key, [flow]);
  }

  const ranked = [...groups.entries()]
    .map(([key, items]) => ({
      key,
      items,
      bytes: items.reduce((total, item) => total + (item.bytes || 0), 0),
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, maxChunks);

  return ranked.map(({ key, items, bytes }) => {
    const [src, dst, protocol] = key.split("|");
    const ports = [...new Set(items.map((item) => item.dst_port).filter(Boolean))].slice(0, 12);
    const range = summarizeRange(items.map((item) => item.ts));
    const packets = items.reduce((total, item) => total + (item.packets || 0), 0);
    const content = [
      `Conversation ${src} -> ${dst} over ${protocol}`,
      `flows=${items.length} bytes=${bytes} packets=${packets}`,
      ports.length ? `destination ports: ${ports.join(", ")}` : "",
      range.start ? `first seen ${range.start}, last seen ${range.end}` : "",
      items[0]?.observation_point ? `observed at ${items[0].observation_point}` : "",
      items[0]?.flags ? `flags ${items[0].flags}` : "",
    ]
      .filter(Boolean)
      .join(". ");

    return { kind: "flow_conversation", content, record_ids: items.slice(0, 60).map((i) => i.id) };
  });
}

export function buildLogChunks(
  logs: (ParsedLog & { id: number })[],
  maxChunks = 160,
): { kind: string; content: string; record_ids: number[] }[] {
  const groupSize = Math.max(4, Math.ceil(logs.length / maxChunks));
  const chunks: { kind: string; content: string; record_ids: number[] }[] = [];

  for (let index = 0; index < logs.length && chunks.length < maxChunks; index += groupSize) {
    const batch = logs.slice(index, index + groupSize);
    const hosts = [...new Set(batch.map((log) => log.host).filter(Boolean))].slice(0, 6);
    const content = [
      hosts.length ? `Log events from ${hosts.join(", ")}` : "Log events",
      batch.map((log) => `[${log.severity ?? "info"}] ${log.message}`).join(" | "),
    ].join(": ");

    chunks.push({
      kind: "log_batch",
      content: content.slice(0, 4000),
      record_ids: batch.map((log) => log.id),
    });
  }

  return chunks;
}
