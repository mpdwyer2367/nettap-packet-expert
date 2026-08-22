import dgram from "node:dgram";
import { log } from "../logger.js";
import { normalizeFlow, type FlowRecord } from "../pipeline/normalize.js";
import type { FlowReceiverConfig } from "../contract.js";
import type { ExporterCounters } from "./netflow.js";

type TemplateField = { type: number; length: number; enterprise?: number };
type Template = { fields: TemplateField[]; isOption: boolean };

function ipv4ToString(buf: Buffer, offset: number): string {
  return `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
}
function ipv6ToString(buf: Buffer, offset: number): string {
  const parts: string[] = [];
  for (let i = 0; i < 8; i++) parts.push(buf.readUInt16BE(offset + i * 2).toString(16));
  return parts.join(":");
}

function readUIntFlexible(b: Buffer): number {
  if (b.length === 0) return 0;
  if (b.length <= 6) return b.readUIntBE(0, b.length);
  return Number(b.readBigUInt64BE(0));
}

/** Element id -> partial normalized field, covering the common IANA elements. */
function decodeElement(type: number, value: Buffer): Record<string, unknown> {
  switch (type) {
    case 1: return { bytes: readUIntFlexible(value) };
    case 2: return { packets: readUIntFlexible(value) };
    case 4: return { protocol: value.length ? value.readUInt8(0) : undefined };
    case 6: return { tcpFlags: value.length ? value.readUInt8(0) : undefined };
    case 7: return { srcPort: value.length >= 2 ? value.readUInt16BE(0) : undefined };
    case 8: return value.length >= 4 ? { srcIp: ipv4ToString(value, 0) } : {};
    case 10: return { ingressIf: readUIntFlexible(value) };
    case 11: return { dstPort: value.length >= 2 ? value.readUInt16BE(0) : undefined };
    case 12: return value.length >= 4 ? { dstIp: ipv4ToString(value, 0) } : {};
    case 14: return { egressIf: readUIntFlexible(value) };
    case 21: return { flowEndSysUpTime: readUIntFlexible(value) };
    case 22: return { flowStartSysUpTime: readUIntFlexible(value) };
    case 27: return value.length >= 16 ? { srcIp: ipv6ToString(value, 0) } : {};
    case 28: return value.length >= 16 ? { dstIp: ipv6ToString(value, 0) } : {};
    case 34: return { samplingInterval: readUIntFlexible(value) };
    case 152: return { flowStartMs: readUIntFlexible(value) };
    case 153: return { flowEndMs: readUIntFlexible(value) };
    case 305: return { samplerRandomInterval: readUIntFlexible(value) };
    default:
      return {};
  }
}

export class IpfixReceiver {
  private socket: dgram.Socket | null = null;
  private templates = new Map<string, Template>(); // key exporter|domain|templateId
  private exporters = new Map<string, ExporterCounters>();

  constructor(
    private cfg: FlowReceiverConfig,
    private emit: (f: FlowRecord) => void,
  ) {}

  private counters(ip: string): ExporterCounters {
    let c = this.exporters.get(ip);
    if (!c) {
      c = { exporter_ip: ip, protocol: "ipfix", version: "v10", templates: 0, sampling_rate: this.cfg.sampling_rate, flows: 0, packets_dropped: 0 };
      this.exporters.set(ip, c);
    }
    return c;
  }

  listExporters(): ExporterCounters[] {
    return Array.from(this.exporters.values());
  }

  private allowed(ip: string): boolean {
    if (!this.cfg.allow_exporters.length) return true;
    return this.cfg.allow_exporters.includes(ip);
  }

  start(): void {
    const socket = dgram.createSocket("udp4");
    socket.on("error", (err) => log.error("ipfix", `Socket error: ${err.message}`, { error: String(err) }));
    socket.on("message", (msg, rinfo) => this.handleMessage(msg, rinfo.address));
    socket.bind(this.cfg.port, this.cfg.bind_address, () => {
      log.info("ipfix", `Listening for IPFIX on ${this.cfg.bind_address}:${this.cfg.port}`);
    });
    this.socket = socket;
  }

  stop(): void {
    this.socket?.close();
    this.socket = null;
  }

  private handleMessage(buf: Buffer, exporterIp: string): void {
    if (!this.allowed(exporterIp)) return;
    if (buf.length < 16) return;
    const version = buf.readUInt16BE(0);
    if (version !== 10) return;
    const length = buf.readUInt16BE(2);
    const exportTime = buf.readUInt32BE(4);
    const domainId = buf.readUInt32BE(12);
    const counters = this.counters(exporterIp);

    try {
      let offset = 16;
      const end = Math.min(length, buf.length);
      while (offset + 4 <= end) {
        const setId = buf.readUInt16BE(offset);
        const setLength = buf.readUInt16BE(offset + 2);
        if (setLength < 4 || offset + setLength > end) break;
        const body = buf.subarray(offset + 4, offset + setLength);

        if (setId === 2) {
          this.parseTemplateSet(body, exporterIp, domainId, false, counters);
        } else if (setId === 3) {
          this.parseTemplateSet(body, exporterIp, domainId, true, counters);
        } else if (setId >= 256) {
          this.parseDataSet(body, setId, exporterIp, domainId, exportTime, counters);
        }
        offset += setLength;
      }
    } catch (err) {
      counters.packets_dropped += 1;
      log.warn("ipfix", "Failed to parse message", { exporterIp, error: String(err) });
    }
  }

  private parseTemplateSet(body: Buffer, exporterIp: string, domainId: number, isOption: boolean, counters: ExporterCounters): void {
    let o = 0;
    while (o + 4 <= body.length) {
      const templateId = body.readUInt16BE(o);
      const fieldCount = body.readUInt16BE(o + 2);
      o += 4;
      let scopeCount = 0;
      if (isOption) {
        if (o + 2 > body.length) break;
        scopeCount = body.readUInt16BE(o);
        o += 2;
      }
      const fields: TemplateField[] = [];
      const totalFields = fieldCount;
      for (let i = 0; i < totalFields && o + 4 <= body.length; i++) {
        const type = body.readUInt16BE(o);
        const length = body.readUInt16BE(o + 2);
        o += 4;
        let enterprise: number | undefined;
        if (type & 0x8000) {
          if (o + 4 > body.length) break;
          enterprise = body.readUInt32BE(o);
          o += 4;
        }
        fields.push({ type: type & 0x7fff, length, enterprise });
      }
      void scopeCount;
      this.templates.set(`${exporterIp}|${domainId}|${templateId}`, { fields, isOption });
      counters.templates = this.templates.size;
    }
  }

  private parseDataSet(body: Buffer, templateId: number, exporterIp: string, domainId: number, exportTime: number, counters: ExporterCounters): void {
    const tmpl = this.templates.get(`${exporterIp}|${domainId}|${templateId}`);
    if (!tmpl || tmpl.isOption || !tmpl.fields.length) return;

    let o = 0;
    while (o < body.length) {
      const values: Record<string, unknown> = {};
      const recordStart = o;
      let ok = true;
      for (const field of tmpl.fields) {
        let len = field.length;
        if (len === 65535) {
          // Variable-length: first byte (or 0xFF + 2-byte length) encodes the size.
          if (o >= body.length) { ok = false; break; }
          const first = body.readUInt8(o);
          if (first === 255) {
            if (o + 3 > body.length) { ok = false; break; }
            len = body.readUInt16BE(o + 1);
            o += 3;
          } else {
            len = first;
            o += 1;
          }
        }
        if (o + len > body.length) { ok = false; break; }
        const value = body.subarray(o, o + len);
        o += len;
        if (!field.enterprise) Object.assign(values, decodeElement(field.type, value));
      }
      if (!ok) break;
      if (o === recordStart) break; // avoid infinite loop on zero-length records

      const v = values as {
        srcIp?: string; dstIp?: string; srcPort?: number; dstPort?: number; protocol?: number;
        packets?: number; bytes?: number; tcpFlags?: number; ingressIf?: number; egressIf?: number;
        samplingInterval?: number; flowStartMs?: number;
      };
      this.emit(
        normalizeFlow({
          ts: v.flowStartMs ? new Date(v.flowStartMs) : new Date(exportTime * 1000),
          exporterIp,
          protocolNum: v.protocol ?? null,
          srcIp: v.srcIp ?? null,
          dstIp: v.dstIp ?? null,
          srcPort: v.srcPort ?? null,
          dstPort: v.dstPort ?? null,
          packets: v.packets ?? 0,
          bytes: v.bytes ?? 0,
          tcpFlags: v.tcpFlags ?? null,
          samplingRate: this.cfg.sampling_rate ?? v.samplingInterval ?? null,
          ingressIf: v.ingressIf ?? null,
          egressIf: v.egressIf ?? null,
          vantage: this.cfg.vantage,
          observationPoint: this.cfg.observation_point,
          source: "ipfix",
        }),
      );
      counters.flows += 1;
    }
  }
}
