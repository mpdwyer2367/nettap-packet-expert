/**
 * Wireshark / tshark export ingestion.
 *
 * tshark cannot run in the browser or in the Worker runtime, so instead of
 * shelling out we accept Wireshark's own decode output. Anything tshark can
 * dissect can therefore be ingested:
 *
 *   tshark -r capture.cap -T json   > capture.json
 *   tshark -r capture.cap -T ek     > capture.ndjson
 *   tshark -r capture.cap -T pdml   > capture.pdml
 *   tshark -r capture.cap -T fields -E header=y -E separator=, \
 *     -e frame.number -e frame.time -e ip.src -e ip.dst -e _ws.col.Protocol \
 *     -e frame.len -e _ws.col.Info > capture.csv
 *
 * Each format is flattened to a field map and mapped onto the same
 * DecodedPacket shape the native pcap decoder produces.
 */

import { getMaxPackets } from "./ingest-capacity";
import { type DecodedFlow, type DecodedPacket, type PcapDecodeResult } from "./pcap-parse";
import { dissectFromFields } from "./dissect";

type FieldMap = Record<string, string>;

const numeric = (value: string | undefined) => {
  if (!value) return null;
  const parsed = Number.parseInt(value.replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

/** tshark writes field names with dots (json/pdml) or underscores (ek). */
function pick(fields: FieldMap, ...names: string[]): string | undefined {
  for (const name of names) {
    const flat = name.replace(/\./g, "_");
    const layer = name.split(".")[0] ?? "";
    // EK output prefixes every field with its layer, e.g. ip.src -> ip_ip_src.
    for (const candidate of [name, flat, `${layer}_${flat}`]) {
      const value = fields[candidate];
      if (value !== undefined && value !== "") return value;
    }
  }
  return undefined;
}

const IP_PROTO_NAMES: Record<number, string> = {
  1: "ICMP",
  6: "TCP",
  17: "UDP",
  47: "GRE",
  50: "ESP",
  58: "ICMPv6",
  132: "SCTP",
};

function timestamp(fields: FieldMap): string | null {
  const epoch = pick(fields, "frame.time_epoch", "timestamp");
  if (epoch) {
    const seconds = Number.parseFloat(epoch);
    if (Number.isFinite(seconds)) {
      const date = new Date(seconds > 1e12 ? seconds : seconds * 1000);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }
  const human = pick(fields, "frame.time_utc", "frame.time", "_ws.col.Time");
  if (human) {
    const date = new Date(human.replace(/ (UTC|GMT)$/, "Z"));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

function tcpFlags(fields: FieldMap): string | null {
  const label = pick(fields, "tcp.flags.str");
  if (label) {
    const named = [
      ["F", "FIN"],
      ["S", "SYN"],
      ["R", "RST"],
      ["P", "PSH"],
      ["A", "ACK"],
      ["U", "URG"],
    ]
      .filter(([short]) => label.includes(short!))
      .map(([, full]) => full!);
    if (named.length > 0) return named.join(",");
  }
  const bits = pick(fields, "tcp.flags");
  if (!bits) return null;
  const value = bits.startsWith("0x") ? Number.parseInt(bits, 16) : numeric(bits);
  if (value === null || !Number.isFinite(value)) return null;
  const labels: string[] = [];
  if (value & 0x01) labels.push("FIN");
  if (value & 0x02) labels.push("SYN");
  if (value & 0x04) labels.push("RST");
  if (value & 0x08) labels.push("PSH");
  if (value & 0x10) labels.push("ACK");
  if (value & 0x20) labels.push("URG");
  return labels.join(",") || null;
}

function toPacket(fields: FieldMap, index: number): DecodedPacket | null {
  const srcIp = pick(fields, "ip.src", "ipv6.src", "arp.src.proto_ipv4") ?? null;
  const dstIp = pick(fields, "ip.dst", "ipv6.dst", "arp.dst.proto_ipv4") ?? null;
  const protoNumber = numeric(pick(fields, "ip.proto", "ipv6.nxt"));
  const columnProtocol = pick(fields, "_ws.col.Protocol", "_ws.col.protocol");
  const protocol =
    columnProtocol ??
    (protoNumber !== null ? (IP_PROTO_NAMES[protoNumber] ?? `IP-${protoNumber}`) : null);

  if (!srcIp && !dstIp && !protocol) return null;

  const srcPort = numeric(pick(fields, "tcp.srcport", "udp.srcport", "sctp.srcport"));
  const dstPort = numeric(pick(fields, "tcp.dstport", "udp.dstport", "sctp.dstport"));
  // Wireshark already dissected the frame, so map its fields onto the same shape
  // the in-browser dissectors produce.
  const dissection = dissectFromFields(
    fields as Record<string, string>,
    { srcPort, dstPort },
    columnProtocol ?? null,
  );

  return {
    frame_number: numeric(pick(fields, "frame.number")) ?? index + 1,
    ts: timestamp(fields),
    src_ip: srcIp,
    dst_ip: dstIp,
    src_port: srcPort,
    dst_port: dstPort,
    protocol,
    length: numeric(pick(fields, "frame.len", "frame.cap_len")) ?? 0,
    tcp_flags: tcpFlags(fields),
    info:
      pick(fields, "_ws.col.Info", "_ws.col.info") ??
      dissection.summary ??
      (protocol ? `${protocol} frame` : null),
    app_protocol: dissection.app_protocol,
    service: dissection.service,
    risk_tags: dissection.risk_tags,
    decryption: "cleartext",
    extra: dissection.fields,
  };
}

/** Rolls decoded packets into 5-tuple conversations so flow tools work on them. */
export function rollupFlows(packets: DecodedPacket[], observationPoint?: string): DecodedFlow[] {
  const flows = new Map<string, DecodedFlow>();
  for (const packet of packets) {
    const key = [
      packet.src_ip ?? "?",
      packet.dst_ip ?? "?",
      packet.src_port ?? "",
      packet.dst_port ?? "",
      packet.protocol ?? "?",
      packet.app_protocol ?? "",
    ].join("|");
    const existing = flows.get(key);
    if (existing) {
      existing.bytes += packet.length;
      existing.packets += 1;
      if (packet.risk_tags.length) {
        existing.risk_tags = [...new Set([...existing.risk_tags, ...packet.risk_tags])];
      }
      for (const [key, value] of Object.entries(packet.extra ?? {})) {
        if (!(key in existing.extra)) existing.extra[key] = value;
      }
      if (packet.tcp_flags) {
        const merged = new Set([
          ...(existing.flags ?? "").split(",").filter(Boolean),
          ...packet.tcp_flags.split(","),
        ]);
        existing.flags = [...merged].join(",");
      }
    } else {
      flows.set(key, {
        ts: packet.ts,
        src_ip: packet.src_ip,
        dst_ip: packet.dst_ip,
        src_port: packet.src_port,
        dst_port: packet.dst_port,
        protocol: packet.protocol,
        bytes: packet.length,
        packets: 1,
        flags: packet.tcp_flags,
        observation_point: observationPoint ?? null,
        app_protocol: packet.app_protocol,
        service: packet.service,
        risk_tags: [...packet.risk_tags],
        extra: { source: "tshark", ...(packet.extra ?? {}) },
      });
    }
  }
  return [...flows.values()];
}

function flattenLayers(layers: Record<string, unknown>, into: FieldMap, prefix = "") {
  for (const [key, value] of Object.entries(layers)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      const first = value[0];
      if (first !== undefined && typeof first !== "object") into[key] = String(first);
      else if (first && typeof first === "object") flattenLayers(first as Record<string, unknown>, into, prefix);
    } else if (typeof value === "object") {
      flattenLayers(value as Record<string, unknown>, into, prefix);
    } else {
      into[key] = String(value);
    }
  }
}

function parseTsharkJson(text: string): FieldMap[] {
  const parsed = JSON.parse(text) as unknown;
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.map((entry) => {
    const fields: FieldMap = {};
    const source = (entry as { _source?: { layers?: Record<string, unknown> } })._source;
    const layers = source?.layers ?? (entry as { layers?: Record<string, unknown> }).layers ?? {};
    flattenLayers(layers, fields);
    return fields;
  });
}

function parseTsharkEk(text: string): FieldMap[] {
  const records: FieldMap[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('{"index"')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const layers = (parsed as { layers?: Record<string, unknown> }).layers;
    if (!layers) continue;
    const fields: FieldMap = {};
    flattenLayers(layers, fields);
    const timestampValue = (parsed as { timestamp?: string | number }).timestamp;
    if (timestampValue !== undefined) fields["timestamp"] = String(timestampValue);
    records.push(fields);
  }
  return records;
}

function parsePdml(text: string): FieldMap[] {
  const records: FieldMap[] = [];
  const packetBlocks = text.split(/<packet>/).slice(1);
  for (const block of packetBlocks) {
    const fields: FieldMap = {};
    const fieldPattern = /<field\s([^>]*?)\/?>/g;
    let match: RegExpExecArray | null;
    while ((match = fieldPattern.exec(block)) !== null) {
      const attributes = match[1] ?? "";
      const nameMatch = /name="([^"]*)"/.exec(attributes);
      const showMatch = /showname="[^"]*"/.test(attributes) ? /(?<!show)show="([^"]*)"/.exec(attributes) : /show="([^"]*)"/.exec(attributes);
      if (nameMatch?.[1] && showMatch?.[1] !== undefined && fields[nameMatch[1]] === undefined) {
        fields[nameMatch[1]] = showMatch[1]!.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      }
    }
    records.push(fields);
  }
  return records;
}

const CSV_ALIASES: Record<string, string> = {
  no: "frame.number",
  "no.": "frame.number",
  number: "frame.number",
  time: "frame.time_epoch",
  source: "ip.src",
  src: "ip.src",
  destination: "ip.dst",
  dst: "ip.dst",
  protocol: "_ws.col.Protocol",
  length: "frame.len",
  len: "frame.len",
  info: "_ws.col.Info",
  srcport: "tcp.srcport",
  dstport: "tcp.dstport",
};

function parseTsharkTable(text: string): FieldMap[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const separator = lines[0]!.includes("\t") ? "\t" : lines[0]!.includes(",") ? "," : "|";
  const split = (line: string) =>
    separator === ","
      ? (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [])
          .map((cell) => cell.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'))
          .slice(0, -1)
      : line.split(separator);

  const header = split(lines[0]!).map((cell) => {
    const key = cell.trim().toLowerCase();
    return CSV_ALIASES[key] ?? cell.trim();
  });

  return lines.slice(1).map((line) => {
    const cells = split(line);
    const fields: FieldMap = {};
    header.forEach((key, index) => {
      const value = cells[index]?.trim();
      if (key && value) fields[key] = value;
    });
    return fields;
  });
}

/** True when the text looks like a Wireshark/tshark decode export. */
export function detectTsharkExport(filename: string, text: string): boolean {
  const head = text.slice(0, 4000);
  if (/<pdml/i.test(head)) return true;
  if (/"_source"\s*:\s*\{\s*"layers"/.test(head)) return true;
  if (/"layers"\s*:\s*\{\s*"frame/.test(head)) return true;
  if (/frame\.(number|time|len)/.test(head) || /_ws\.col\./.test(head)) return true;
  if (/\.(pdml|json|ndjson)$/i.test(filename) && /frame/i.test(head)) return true;
  // Wireshark's "Export packet dissections as CSV" column header.
  const firstLine = head.split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
  if (
    /(^|[,\t|"])(no\.?|frame)("|)[,\t|]/.test(firstLine) &&
    /source/.test(firstLine) &&
    /destination/.test(firstLine) &&
    /protocol/.test(firstLine)
  ) {
    return true;
  }

  return false;
}

/** Converts a Wireshark/tshark export into packet + flow records. */
export function decodeTsharkExport(
  text: string,
  filename: string,
  observationPoint?: string,
): PcapDecodeResult {
  const head = text.trimStart();
  let records: FieldMap[];

  if (/<pdml/i.test(head.slice(0, 500)) || /\.pdml$/i.test(filename)) {
    records = parsePdml(text);
  } else if (head.startsWith("[") || head.startsWith("{\n  \"_source\"") || /^\{\s*"_source"/.test(head)) {
    records = parseTsharkJson(text);
  } else if (head.startsWith("{")) {
    records = parseTsharkEk(text);
    if (records.length === 0) records = parseTsharkJson(text);
  } else {
    records = parseTsharkTable(text);
  }

  if (records.length === 0) {
    throw new Error(
      "No packets were found in this Wireshark/tshark export. Re-run tshark with -T json, -T ek, -T pdml, or -T fields with a header row.",
    );
  }

  const totalPackets = records.length;
  const ceiling = getMaxPackets();
  const sampled = totalPackets > ceiling;
  const step = sampled ? Math.ceil(totalPackets / ceiling) : 1;

  const packets: DecodedPacket[] = [];
  let skipped = 0;
  for (let index = 0; index < records.length; index += step) {
    const packet = toPacket(records[index]!, index);
    if (packet) packets.push(packet);
    else skipped += 1;
  }

  if (packets.length === 0) {
    throw new Error(
      `Read ${totalPackets} rows from the Wireshark export but none carried addressing or protocol fields. Include at least ip.src, ip.dst and _ws.col.Protocol.`,
    );
  }

  return {
    packets,
    flows: rollupFlows(packets, observationPoint),
    totalPackets,
    skipped,
    linkTypes: [],
    sampled,
  };
}
