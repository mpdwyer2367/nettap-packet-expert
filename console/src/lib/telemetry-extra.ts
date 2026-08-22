/**
 * Parsers for the non-flow, non-syslog telemetry sources: SNMP counter/metric
 * tables and WMI class or event dumps, plus chunk builders for every extra
 * record type (packets, SNMP, WMI) used by semantic search.
 */

export const MAX_EXTRA_RECORDS = 20000;

export type ParsedSnmp = {
  ts: string | null;
  host: string | null;
  interface_name: string | null;
  oid: string | null;
  metric: string;
  value: number | null;
  value_text: string | null;
  extra: Record<string, string>;
};

export type ParsedWmi = {
  ts: string | null;
  host: string | null;
  wmi_class: string | null;
  event_id: string | null;
  level: string | null;
  message: string;
  extra: Record<string, string>;
};

export type Chunk = { kind: string; content: string; record_ids: number[] };

function pick(headers: string[], aliases: string[]) {
  for (const alias of aliases) {
    const found = headers.find((header) => header === alias);
    if (found) return found;
  }
  for (const alias of aliases) {
    const found = headers.find((header) => header.includes(alias));
    if (found) return found;
  }
  return undefined;
}

function stamp(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{10}$/.test(trimmed)) return new Date(Number(trimmed) * 1000).toISOString();
  if (/^\d{13}$/.test(trimmed)) return new Date(Number(trimmed)).toISOString();
  // WMI/CIM DATETIME: 20240612153001.000000+000
  const cim = trimmed.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (cim && trimmed.length >= 14) {
    const iso = `${cim[1]}-${cim[2]}-${cim[3]}T${cim[4]}:${cim[5]}:${cim[6]}Z`;
    const parsedCim = new Date(iso);
    if (!Number.isNaN(parsedCim.getTime())) return parsedCim.toISOString();
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function num(value: string | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  const cleaned = value.toString().replace(/[, ]/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function rest(row: Record<string, string>, used: (string | undefined)[]) {
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (used.includes(key)) continue;
    const trimmed = (value ?? "").toString().trim();
    if (trimmed) extra[key] = trimmed.slice(0, 200);
  }
  return extra;
}

const SNMP_SIGNALS = ["oid", "snmp", "ifindex", "ifdescr", "ifhcinoctets", "ifinoctets", "sysuptime"];
const WMI_SIGNALS = ["wmi", "win32_", "cim_", "classname", "wmi_class", "eventcode", "logfile", "recordnumber"];

export function looksLikeSnmpCsv(headers: string[]) {
  const hits = headers.filter((header) => SNMP_SIGNALS.some((signal) => header.includes(signal)));
  if (hits.length > 0) return true;
  const hasMetric = Boolean(pick(headers, ["metric", "counter", "gauge"]));
  const hasValue = Boolean(pick(headers, ["value", "reading"]));
  return hasMetric && hasValue;
}

export function looksLikeWmiCsv(headers: string[]) {
  return headers.some((header) => WMI_SIGNALS.some((signal) => header.includes(signal)));
}

export function parseSnmpCsv(rows: Record<string, string>[], headers: string[]) {
  const tsCol = pick(headers, ["ts", "timestamp", "time", "date", "polled_at"]);
  const hostCol = pick(headers, ["host", "hostname", "device", "agent", "target", "ip", "node"]);
  const ifCol = pick(headers, ["ifname", "ifdescr", "interface", "port", "ifindex", "ifalias"]);
  const oidCol = pick(headers, ["oid", "object_id"]);
  const metricCol = pick(headers, ["metric", "name", "counter", "mib", "object", "gauge"]);
  const valueCol = pick(headers, ["value", "reading", "result", "count"]);

  const records: ParsedSnmp[] = [];
  let skipped = 0;

  for (const row of rows.slice(0, MAX_EXTRA_RECORDS)) {
    const metric = (metricCol ? row[metricCol] : undefined)?.trim() || (oidCol ? row[oidCol]?.trim() : "") || "";
    const rawValue = valueCol ? row[valueCol] : undefined;
    if (!metric && rawValue === undefined) {
      skipped += 1;
      continue;
    }
    const value = num(rawValue);
    records.push({
      ts: stamp(tsCol ? row[tsCol] : undefined),
      host: (hostCol ? row[hostCol]?.trim() : null) || null,
      interface_name: (ifCol ? row[ifCol]?.trim() : null) || null,
      oid: (oidCol ? row[oidCol]?.trim() : null) || null,
      metric: (metric || "value").slice(0, 200),
      value,
      value_text: value === null ? (rawValue ?? "").toString().trim().slice(0, 200) || null : null,
      extra: rest(row, [tsCol, hostCol, ifCol, oidCol, metricCol, valueCol]),
    });
  }

  return { kind: "snmp" as const, snmp: records, skipped };
}

export function parseWmiCsv(rows: Record<string, string>[], headers: string[]) {
  const tsCol = pick(headers, ["timegenerated", "timewritten", "ts", "timestamp", "time", "date", "creationdate"]);
  const hostCol = pick(headers, ["computername", "csname", "host", "hostname", "pscomputername", "systemname"]);
  const classCol = pick(headers, ["wmi_class", "classname", "class", "__class", "logfile", "provider"]);
  const eventCol = pick(headers, ["eventcode", "eventid", "event_id", "recordnumber", "instanceid"]);
  const levelCol = pick(headers, ["type", "level", "severity", "entrytype", "category"]);
  const messageCol = pick(headers, ["message", "description", "insertionstrings", "name", "caption"]);

  const records: ParsedWmi[] = [];
  let skipped = 0;

  for (const row of rows.slice(0, MAX_EXTRA_RECORDS)) {
    const message =
      (messageCol ? row[messageCol]?.trim() : "") ||
      Object.entries(row)
        .filter(([, value]) => (value ?? "").toString().trim())
        .map(([key, value]) => `${key}=${value}`)
        .join(" ");
    if (!message) {
      skipped += 1;
      continue;
    }
    records.push({
      ts: stamp(tsCol ? row[tsCol] : undefined),
      host: (hostCol ? row[hostCol]?.trim() : null) || null,
      wmi_class: (classCol ? row[classCol]?.trim() : null) || null,
      event_id: (eventCol ? row[eventCol]?.trim() : null) || null,
      level: (levelCol ? row[levelCol]?.trim().toLowerCase() : null) || null,
      message: message.slice(0, 2000),
      extra: rest(row, [tsCol, hostCol, classCol, eventCol, levelCol, messageCol]),
    });
  }

  return { kind: "wmi" as const, wmi: records, skipped };
}

/* ------------------------------------------------------------------ */
/* Chunk builders                                                      */
/* ------------------------------------------------------------------ */

export function buildSnmpChunks(records: (ParsedSnmp & { id: number })[], maxChunks = 160): Chunk[] {
  const groups = new Map<string, (ParsedSnmp & { id: number })[]>();
  for (const record of records) {
    const key = `${record.host ?? "?"}|${record.interface_name ?? "-"}|${record.metric}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(record);
    else groups.set(key, [record]);
  }

  return [...groups.entries()]
    .slice(0, maxChunks)
    .map(([key, items]) => {
      const [host, iface, metric] = key.split("|");
      const values = items.map((item) => item.value).filter((value): value is number => value !== null);
      const min = values.length ? Math.min(...values) : null;
      const max = values.length ? Math.max(...values) : null;
      const avg = values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
      const content = [
        `SNMP metric ${metric} on ${host}${iface && iface !== "-" ? ` interface ${iface}` : ""}`,
        `samples=${items.length}`,
        values.length ? `min=${min} max=${max} avg=${avg?.toFixed(2)}` : "non-numeric samples",
        items[0]?.oid ? `oid ${items[0].oid}` : "",
      ]
        .filter(Boolean)
        .join(". ");
      return { kind: "snmp_metric", content, record_ids: items.slice(0, 60).map((item) => item.id) };
    });
}

export function buildWmiChunks(records: (ParsedWmi & { id: number })[], maxChunks = 160): Chunk[] {
  const groupSize = Math.max(3, Math.ceil(records.length / maxChunks));
  const chunks: Chunk[] = [];
  for (let index = 0; index < records.length && chunks.length < maxChunks; index += groupSize) {
    const batch = records.slice(index, index + groupSize);
    const hosts = [...new Set(batch.map((item) => item.host).filter(Boolean))].slice(0, 6);
    const classes = [...new Set(batch.map((item) => item.wmi_class).filter(Boolean))].slice(0, 6);
    const content = [
      `WMI records${hosts.length ? ` from ${hosts.join(", ")}` : ""}${classes.length ? ` (${classes.join(", ")})` : ""}`,
      batch.map((item) => `[${item.level ?? "info"}${item.event_id ? ` ${item.event_id}` : ""}] ${item.message}`).join(" | "),
    ].join(": ");
    chunks.push({ kind: "wmi_batch", content: content.slice(0, 4000), record_ids: batch.map((item) => item.id) });
  }
  return chunks;
}

export type PacketLike = {
  id: number;
  ts: string | null;
  src_ip: string | null;
  dst_ip: string | null;
  dst_port: number | null;
  protocol: string | null;
  length: number;
  tcp_flags: string | null;
};

export function buildPacketChunks(packets: PacketLike[], maxChunks = 120): Chunk[] {
  const groups = new Map<string, PacketLike[]>();
  for (const packet of packets) {
    const key = `${packet.src_ip ?? "?"}|${packet.dst_ip ?? "?"}|${packet.protocol ?? "?"}|${packet.dst_port ?? "-"}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(packet);
    else groups.set(key, [packet]);
  }

  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, maxChunks)
    .map(([key, items]) => {
      const [src, dst, protocol, port] = key.split("|");
      const bytes = items.reduce((total, item) => total + (item.length || 0), 0);
      const flags = [...new Set(items.flatMap((item) => (item.tcp_flags ?? "").split(",")).filter(Boolean))];
      const times = items.map((item) => item.ts).filter((value): value is string => Boolean(value)).sort();
      const content = [
        `Packet stream ${src} -> ${dst} ${protocol}${port !== "-" ? ` port ${port}` : ""}`,
        `packets=${items.length} bytes=${bytes}`,
        flags.length ? `tcp flags seen: ${flags.join(",")}` : "",
        times.length ? `from ${times[0]} to ${times[times.length - 1]}` : "",
      ]
        .filter(Boolean)
        .join(". ");
      return { kind: "packet_stream", content, record_ids: items.slice(0, 60).map((item) => item.id) };
    });
}
