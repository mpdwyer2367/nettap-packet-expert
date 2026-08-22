/**
 * Pure-TypeScript pcap / pcapng decoder (browser side).
 *
 * Raw captures are binary, so they are decoded in the browser and only the
 * resulting packet + flow records travel to the server. No native dependency,
 * which the Worker runtime could not load anyway.
 *
 * Layer 2-4 headers are decoded here; application protocols (DNS, HTTP, TLS,
 * SMB, Kerberos, LDAP, SIP, ...) are handed to `./dissect`.
 */

import { getMaxPackets } from "./ingest-capacity";
import { dissectLinkLayer, dissectPayload, EMPTY_DISSECTION, type DissectResult } from "./dissect";

export type DecodedPacket = {
  frame_number: number;
  ts: string | null;
  src_ip: string | null;
  dst_ip: string | null;
  src_port: number | null;
  dst_port: number | null;
  protocol: string | null;
  length: number;
  tcp_flags: string | null;
  info: string | null;
  app_protocol: string | null;
  service: string | null;
  risk_tags: string[];
  decryption?: string;
  extra: Record<string, string>;
};

export type DecodedFlow = {
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
  app_protocol: string | null;
  service: string | null;
  risk_tags: string[];
  extra: Record<string, string>;
};


export type PcapDecodeResult = {
  packets: DecodedPacket[];
  flows: DecodedFlow[];
  totalPackets: number;
  skipped: number;
  linkTypes: number[];
  sampled: boolean;
};

/**
 * Legacy default decode ceiling. The live ceiling is a setting — see
 * `getMaxPackets()` in ./ingest-capacity — so large captures are limited by the
 * configured profile and available memory, not by this constant.
 */
export const MAX_PACKETS = 20000;

const LINKTYPE_ETHERNET = 1;
const LINKTYPE_RAW_IP = 101;
const LINKTYPE_NULL = 0;
const LINKTYPE_LINUX_SLL = 113;
// Additional Wireshark link types commonly produced by taps and brokers.
const LINKTYPE_PPP = 9;
const LINKTYPE_RAW_BSD = 12;
const LINKTYPE_RAW_OPENBSD = 14;
const LINKTYPE_LOOP = 108;
const LINKTYPE_IEEE802_11 = 105;
const LINKTYPE_IEEE802_11_RADIOTAP = 127;
const LINKTYPE_IPV4 = 228;
const LINKTYPE_IPV6 = 229;
const LINKTYPE_LINUX_SLL2 = 276;


const PROTO_NAMES: Record<number, string> = {
  1: "ICMP",
  6: "TCP",
  17: "UDP",
  47: "GRE",
  50: "ESP",
  58: "ICMPv6",
  132: "SCTP",
};

function ipv4(view: DataView, offset: number) {
  return `${view.getUint8(offset)}.${view.getUint8(offset + 1)}.${view.getUint8(offset + 2)}.${view.getUint8(offset + 3)}`;
}

function ipv6(view: DataView, offset: number) {
  const parts: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    parts.push(view.getUint16(offset + index * 2, false).toString(16));
  }
  return parts.join(":").replace(/\b:?(?:0+:?){2,}/, "::");
}

function tcpFlagLabels(bits: number) {
  const labels: string[] = [];
  if (bits & 0x01) labels.push("FIN");
  if (bits & 0x02) labels.push("SYN");
  if (bits & 0x04) labels.push("RST");
  if (bits & 0x08) labels.push("PSH");
  if (bits & 0x10) labels.push("ACK");
  if (bits & 0x20) labels.push("URG");
  if (bits & 0x40) labels.push("ECE");
  if (bits & 0x80) labels.push("CWR");
  return labels.join(",");
}

function slice(view: DataView, start: number, end: number) {
  const from = Math.max(0, start);
  const to = Math.min(view.byteLength, end);
  return to > from ? new Uint8Array(view.buffer, view.byteOffset + from, to - from) : new Uint8Array(0);
}

type Layer3 = {
  src_ip: string | null;
  dst_ip: string | null;
  src_port: number | null;
  dst_port: number | null;
  protocol: string | null;
  tcp_flags: string | null;
  info: string | null;
  dissection: DissectResult;
  /** TCP stream position, kept so the decryption pass can reassemble records. */
  tcp_seq: number | null;
  payload_start: number | null;
  payload_end: number | null;
  ip_proto: number | null;
};

function decodeIp(view: DataView, start: number, end: number): Layer3 | null {
  if (start + 1 > end) return null;
  const version = view.getUint8(start) >> 4;

  let protocolNumber: number;
  let payload: number;
  let src: string;
  let dst: string;
  let ipEnd = end;

  if (version === 4) {
    if (start + 20 > end) return null;
    const ihl = (view.getUint8(start) & 0x0f) * 4;
    protocolNumber = view.getUint8(start + 9);
    src = ipv4(view, start + 12);
    dst = ipv4(view, start + 16);
    payload = start + Math.max(ihl, 20);
    const totalLength = view.getUint16(start + 2, false);
    if (totalLength > 0 && start + totalLength <= end) ipEnd = start + totalLength;
  } else if (version === 6) {
    if (start + 40 > end) return null;
    protocolNumber = view.getUint8(start + 6);
    src = ipv6(view, start + 8);
    dst = ipv6(view, start + 24);
    payload = start + 40;
    const payloadLength = view.getUint16(start + 4, false);
    if (payloadLength > 0 && payload + payloadLength <= end) ipEnd = payload + payloadLength;
  } else {
    return null;
  }

  const protocol = PROTO_NAMES[protocolNumber] ?? `IP-${protocolNumber}`;
  let srcPort: number | null = null;
  let dstPort: number | null = null;
  let flags: string | null = null;
  let info: string | null = null;
  let appStart = payload;
  let tcpSeq: number | null = null;

  if ((protocolNumber === 6 || protocolNumber === 17 || protocolNumber === 132) && payload + 4 <= end) {
    srcPort = view.getUint16(payload, false);
    dstPort = view.getUint16(payload + 2, false);
  }
  if (protocolNumber === 6 && payload + 20 <= end) {
    flags = tcpFlagLabels(view.getUint8(payload + 13)) || null;
    info = flags ? `TCP ${flags}` : "TCP";
    tcpSeq = view.getUint32(payload + 4, false);
    const dataOffset = (view.getUint8(payload + 12) >> 4) * 4;
    appStart = payload + Math.max(dataOffset, 20);
  } else if (protocolNumber === 17) {
    info = "UDP datagram";
    appStart = payload + 8;
  } else if (protocolNumber === 1 && payload + 2 <= end) {
    info = `ICMP type ${view.getUint8(payload)} code ${view.getUint8(payload + 1)}`;
  }

  const appEnd = Math.min(ipEnd, end);
  const bytes =
    appStart < appEnd
      ? new Uint8Array(view.buffer, view.byteOffset + appStart, appEnd - appStart)
      : new Uint8Array(0);

  const dissection = dissectPayload({
    ipProto: protocolNumber,
    srcPort,
    dstPort,
    payload: bytes,
  });

  return {
    src_ip: src,
    dst_ip: dst,
    src_port: srcPort,
    dst_port: dstPort,
    protocol,
    tcp_flags: flags,
    info: dissection.summary ?? info,
    dissection,
    tcp_seq: tcpSeq,
    payload_start: appStart,
    payload_end: appEnd,
    ip_proto: protocolNumber,
  };
}


function decodeFrame(view: DataView, start: number, end: number, linkType: number): Layer3 | null {
  if (linkType === LINKTYPE_ETHERNET) {
    if (start + 14 > end) return null;
    let etherType = view.getUint16(start + 12, false);
    let offset = start + 14;
    // Walk VLAN tags (802.1Q / QinQ) which NetTAP brokers commonly add.
    let guard = 0;
    while ((etherType === 0x8100 || etherType === 0x88a8) && offset + 4 <= end && guard < 3) {
      etherType = view.getUint16(offset + 2, false);
      offset += 4;
      guard += 1;
    }
    if (etherType === 0x0800 || etherType === 0x86dd) return decodeIp(view, offset, end);
    if (etherType === 0x0806) {
      return {
        src_ip: null,
        dst_ip: null,
        src_port: null,
        dst_port: null,
        protocol: "ARP",
        tcp_flags: null,
        info: "ARP frame",
        dissection: EMPTY_DISSECTION,
        tcp_seq: null,
        payload_start: null,
        payload_end: null,
        ip_proto: null,
      };
    }
    // Link-layer discovery frames (LLDP directly, CDP over LLC/SNAP).
    let linkDissection: DissectResult | null = null;
    if (etherType === 0x88cc) {
      linkDissection = dissectLinkLayer(0x88cc, slice(view, offset, end));
    } else if (etherType <= 1500 && offset + 8 <= end) {
      const oui = (view.getUint8(offset + 3) << 16) | (view.getUint8(offset + 4) << 8) | view.getUint8(offset + 5);
      const pid = view.getUint16(offset + 6, false);
      if (oui === 0x00000c && pid === 0x2000) {
        linkDissection = dissectLinkLayer(0x2000, slice(view, offset + 8, end));
      }
    }
    if (linkDissection) {
      return {
        src_ip: null,
        dst_ip: null,
        src_port: null,
        dst_port: null,
        protocol: linkDissection.app_protocol,
        tcp_flags: null,
        info: linkDissection.summary,
        dissection: linkDissection,
        tcp_seq: null,
        payload_start: null,
        payload_end: null,
        ip_proto: null,
      };
    }
    return null;
  }
  if (
    linkType === LINKTYPE_RAW_IP ||
    linkType === LINKTYPE_RAW_BSD ||
    linkType === LINKTYPE_RAW_OPENBSD ||
    linkType === LINKTYPE_IPV4 ||
    linkType === LINKTYPE_IPV6
  ) {
    return decodeIp(view, start, end);
  }
  if (linkType === LINKTYPE_NULL || linkType === LINKTYPE_LOOP) return decodeIp(view, start + 4, end);
  if (linkType === LINKTYPE_LINUX_SLL) return decodeIp(view, start + 16, end);
  if (linkType === LINKTYPE_LINUX_SLL2) return decodeIp(view, start + 20, end);
  if (linkType === LINKTYPE_PPP) {
    // 0xff03 HDLC framing is optional; skip it when present, then the protocol field.
    const hdlc = start + 2 <= end && view.getUint16(start, false) === 0xff03 ? start + 2 : start;
    if (hdlc + 2 > end) return null;
    const protocol = view.getUint16(hdlc, false);
    if (protocol === 0x0021 || protocol === 0x0057) return decodeIp(view, hdlc + 2, end);
    return null;
  }
  if (linkType === LINKTYPE_IEEE802_11 || linkType === LINKTYPE_IEEE802_11_RADIOTAP) {
    let offset = start;
    if (linkType === LINKTYPE_IEEE802_11_RADIOTAP) {
      if (start + 4 > end) return null;
      offset = start + view.getUint16(start + 2, true);
      if (offset + 24 > end) return null;
    }
    // 24-byte data frame header + 8-byte LLC/SNAP, then the EtherType.
    const snap = offset + 24;
    if (snap + 8 > end) return null;
    const etherType = view.getUint16(snap + 6, false);
    if (etherType === 0x0800 || etherType === 0x86dd) return decodeIp(view, snap + 8, end);
    return null;
  }
  return null;
}


function isoFrom(seconds: number, fraction: number, nanos: boolean) {
  const ms = seconds * 1000 + (nanos ? fraction / 1e6 : fraction / 1000);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

type RawPacket = { ts: string | null; caplen: number; origlen: number; start: number; linkType: number };

function readClassicPcap(view: DataView, little: boolean, nanos: boolean): RawPacket[] {
  const linkType = view.getUint32(20, little);
  const packets: RawPacket[] = [];
  let offset = 24;
  while (offset + 16 <= view.byteLength) {
    const seconds = view.getUint32(offset, little);
    const fraction = view.getUint32(offset + 4, little);
    const caplen = view.getUint32(offset + 8, little);
    const origlen = view.getUint32(offset + 12, little);
    const start = offset + 16;
    if (caplen > 262144 || start + caplen > view.byteLength) break;
    packets.push({ ts: isoFrom(seconds, fraction, nanos), caplen, origlen, start, linkType });
    offset = start + caplen;
  }
  return packets;
}

function readPcapng(view: DataView): RawPacket[] {
  const packets: RawPacket[] = [];
  let offset = 0;
  let little = true;
  const interfaceLinkTypes: number[] = [];

  while (offset + 12 <= view.byteLength) {
    const blockType = view.getUint32(offset, little);
    if (blockType === 0x0a0d0d0a) {
      const magic = view.getUint32(offset + 8, true);
      little = magic === 0x1a2b3c4d;
    }
    const blockLength = view.getUint32(offset + 4, little);
    if (blockLength < 12 || offset + blockLength > view.byteLength) break;

    if (blockType === 0x00000001) {
      interfaceLinkTypes.push(view.getUint16(offset + 8, little));
    } else if (blockType === 0x00000006) {
      const interfaceId = view.getUint32(offset + 8, little);
      const tsHigh = view.getUint32(offset + 12, little);
      const tsLow = view.getUint32(offset + 16, little);
      const caplen = view.getUint32(offset + 20, little);
      const origlen = view.getUint32(offset + 24, little);
      const micros = tsHigh * 4294967296 + tsLow; // default resolution: microseconds
      const start = offset + 28;
      if (start + caplen <= view.byteLength) {
        const date = new Date(micros / 1000);
        packets.push({
          ts: Number.isNaN(date.getTime()) ? null : date.toISOString(),
          caplen,
          origlen,
          start,
          linkType: interfaceLinkTypes[interfaceId] ?? LINKTYPE_ETHERNET,
        });
      }
    } else if (blockType === 0x00000003) {
      const origlen = view.getUint32(offset + 8, little);
      packets.push({
        ts: null,
        caplen: Math.min(origlen, blockLength - 16),
        origlen,
        start: offset + 12,
        linkType: interfaceLinkTypes[0] ?? LINKTYPE_ETHERNET,
      });
    }

    offset += blockLength;
  }
  return packets;
}

export function isCaptureFile(filename: string) {
  return /\.(pcap|pcapng|cap|dmp|pkt|ntar|snoop)(\.gz)?$/i.test(filename);
}

function ascii(view: DataView, offset: number, length: number) {
  let text = "";
  for (let index = 0; index < length && offset + index < view.byteLength; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index));
  }
  return text;
}

/**
 * Reads a capture file, transparently gunzipping `.gz` captures (Wireshark
 * writes these by default when compression is enabled).
 */
export async function readCaptureBuffer(file: File): Promise<ArrayBuffer> {
  const buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer.slice(0, 2));
  const gzipped = head[0] === 0x1f && head[1] === 0x8b;
  if (!gzipped) return buffer;
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot decompress .gz captures. Extract the capture first.");
  }
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export type { Layer3 };
export type RawFrame = RawPacket;

/** Decodes a frame's IP layer straight from bytes (used after decryption). */
export function decodeIpBytes(bytes: Uint8Array): Layer3 | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return decodeIp(view, 0, bytes.byteLength);
}

/** Decodes any supported link-layer frame from bytes. */
export function decodeFrameBytes(bytes: Uint8Array, linkType: number): Layer3 | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return decodeFrame(view, 0, bytes.byteLength, linkType);
}

/**
 * Splits a capture buffer into raw frame records. Shared by the decoder and the
 * decryption passes so both walk the file the same way.
 */
export function readRawFrames(view: DataView): RawPacket[] {
  if (view.byteLength < 24) throw new Error("This file is too small to be a packet capture.");
  const magic = view.getUint32(0, false);
  if (magic === 0x0a0d0d0a) return readPcapng(view);
  if (magic === 0xa1b2c3d4) return readClassicPcap(view, false, false);
  if (magic === 0xd4c3b2a1) return readClassicPcap(view, true, false);
  if (magic === 0xa1b23c4d) return readClassicPcap(view, false, true);
  if (magic === 0x4d3cb2a1) return readClassicPcap(view, true, true);
  return [];
}

export function frameBytes(view: DataView, frame: RawPacket) {
  return slice(view, frame.start, frame.start + frame.caplen);
}

/** Decodes a pcap/pcapng buffer into packet records and rolled-up flows. */
export function decodeCapture(buffer: ArrayBuffer, observationPoint?: string): PcapDecodeResult {
  const view = new DataView(buffer);
  if (view.byteLength < 24) throw new Error("This file is too small to be a packet capture.");

  const magic = view.getUint32(0, false);
  let raw: RawPacket[];

  if (magic === 0x0a0d0d0a) {
    raw = readPcapng(view);
  } else if (magic === 0xa1b2c3d4) {
    raw = readClassicPcap(view, false, false);
  } else if (magic === 0xd4c3b2a1) {
    raw = readClassicPcap(view, true, false);
  } else if (magic === 0xa1b23c4d) {
    raw = readClassicPcap(view, false, true);
  } else if (magic === 0x4d3cb2a1) {
    raw = readClassicPcap(view, true, true);
  } else {
    const signature = ascii(view, 0, 8);
    const legacy =
      signature.startsWith("GMBU") || signature.startsWith("RTSS")
        ? "Microsoft Network Monitor"
        : signature.startsWith("TRSNIFF")
          ? "NetXRay/Sniffer"
          : signature.startsWith("snoop")
            ? "Sun snoop"
            : signature.startsWith("\x34\xcd\xb2\xa1")
              ? "modified libpcap"
              : null;
    throw new Error(
      legacy
        ? `This .cap file is a ${legacy} capture, which needs Wireshark's own dissector. Convert it with: tshark -r input.cap -F pcapng -w converted.pcapng — or upload a decode export: tshark -r input.cap -T json > capture.json`
        : "Unrecognised capture header. Supported: libpcap (.pcap/.cap), pcapng (.pcapng), gzip-compressed variants, and Wireshark/tshark exports (-T json, -T ek, -T pdml, -T fields).",
    );
  }


  if (raw.length === 0) throw new Error("No packet records were found inside this capture.");

  const totalPackets = raw.length;
  const ceiling = getMaxPackets();
  const sampled = totalPackets > ceiling;
  const step = sampled ? Math.ceil(totalPackets / ceiling) : 1;

  const packets: DecodedPacket[] = [];
  const flowMap = new Map<string, DecodedFlow>();
  const linkTypes = new Set<number>();
  let skipped = 0;

  for (let index = 0; index < raw.length; index += step) {
    const item = raw[index]!;
    linkTypes.add(item.linkType);
    const layer = decodeFrame(view, item.start, item.start + item.caplen, item.linkType);
    if (!layer) {
      skipped += 1;
      continue;
    }

    const length = item.origlen || item.caplen;
    const dissection = layer.dissection;
    packets.push({
      frame_number: index + 1,
      ts: item.ts,
      src_ip: layer.src_ip,
      dst_ip: layer.dst_ip,
      src_port: layer.src_port,
      dst_port: layer.dst_port,
      protocol: layer.protocol,
      length,
      tcp_flags: layer.tcp_flags,
      info: layer.info,
      app_protocol: dissection.app_protocol,
      service: dissection.service,
      risk_tags: dissection.risk_tags,
      decryption: "cleartext",
      extra: dissection.fields,
    });

    const key = [
      layer.src_ip ?? "?",
      layer.dst_ip ?? "?",
      layer.src_port ?? "",
      layer.dst_port ?? "",
      layer.protocol ?? "?",
      layer.dissection.app_protocol ?? "",
    ].join("|");
    const existing = flowMap.get(key);
    if (existing) {
      existing.bytes += length;
      existing.packets += 1;
      if (dissection.risk_tags.length) {
        existing.risk_tags = [...new Set([...existing.risk_tags, ...dissection.risk_tags])];
      }
      for (const [key, value] of Object.entries(dissection.fields)) {
        if (!(key in existing.extra)) existing.extra[key] = value;
      }
      if (layer.tcp_flags) {
        const merged = new Set([...(existing.flags ?? "").split(",").filter(Boolean), ...layer.tcp_flags.split(",")]);
        existing.flags = [...merged].join(",");
      }
    } else {
      flowMap.set(key, {
        ts: item.ts,
        src_ip: layer.src_ip,
        dst_ip: layer.dst_ip,
        src_port: layer.src_port,
        dst_port: layer.dst_port,
        protocol: layer.protocol,
        bytes: length,
        packets: 1,
        flags: layer.tcp_flags,
        observation_point: observationPoint ?? null,
        app_protocol: dissection.app_protocol,
        service: dissection.service,
        risk_tags: [...dissection.risk_tags],
        extra: { source: "pcap", ...dissection.fields },
      });
    }
  }

  if (packets.length === 0) {
    throw new Error(
      `Decoded ${totalPackets} frames but none carried IP/ARP payloads (link types: ${[...linkTypes].join(", ")}). Run it through Wireshark instead: tshark -r input.cap -T json > capture.json and upload that export.`,
    );
  }

  return {
    packets,
    flows: [...flowMap.values()],
    totalPackets,
    skipped,
    linkTypes: [...linkTypes],
    sampled,
  };
}
