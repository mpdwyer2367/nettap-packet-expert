import dgram from "node:dgram";
import { log } from "../logger.js";
import { normalizeFlow, type FlowRecord } from "../pipeline/normalize.js";
import type { FlowReceiverConfig } from "../contract.js";

export type ExporterCounters = {
  exporter_ip: string;
  protocol: string;
  version: string | null;
  templates: number;
  sampling_rate: number | null;
  flows: number;
  packets_dropped: number;
};

type TemplateField = { type: number; length: number };
type Template = { fields: TemplateField[]; isOption: boolean };

function ipv4ToString(buf: Buffer, offset: number): string {
  return `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
}

/** NetFlow v5 fixed record is 48 bytes; header is 24 bytes. */
function parseV5(buf: Buffer, exporterIp: string, cfg: FlowReceiverConfig, emit: (f: FlowRecord) => void, counters: ExporterCounters) {
  if (buf.length < 24) return;
  const count = buf.readUInt16BE(2);
  const sysUptime = buf.readUInt32BE(4);
  const unixSecs = buf.readUInt32BE(8);
  const samplingField = buf.readUInt16BE(22);
  const samplingRate = (samplingField & 0x3fff) || null;
  counters.sampling_rate = cfg.sampling_rate ?? samplingRate;
  counters.version = "v5";

  let offset = 24;
  for (let i = 0; i < count && offset + 48 <= buf.length; i++, offset += 48) {
    const srcIp = ipv4ToString(buf, offset);
    const dstIp = ipv4ToString(buf, offset + 4);
    const packets = buf.readUInt32BE(offset + 16);
    const bytes = buf.readUInt32BE(offset + 20);
    const srcPort = buf.readUInt16BE(offset + 32);
    const dstPort = buf.readUInt16BE(offset + 34);
    const tcpFlags = buf.readUInt8(offset + 37);
    const protocol = buf.readUInt8(offset + 38);
    const flowSeq = sysUptime; // not used further, kept for clarity of layout

    void flowSeq;
    emit(
      normalizeFlow({
        ts: new Date(unixSecs * 1000),
        exporterIp,
        protocolNum: protocol,
        srcIp,
        dstIp,
        srcPort,
        dstPort,
        packets,
        bytes,
        tcpFlags,
        samplingRate: counters.sampling_rate,
        ingressIf: buf.readUInt16BE(offset + 12),
        egressIf: buf.readUInt16BE(offset + 14),
        vantage: cfg.vantage,
        observationPoint: cfg.observation_point,
        source: "netflow",
      }),
    );
    counters.flows += 1;
  }
}

/** IANA-ish element types used by NetFlow v9 templates (subset, matches IPFIX numbering). */
function fieldToPartial(type: number, value: Buffer): Partial<{
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  protocol: number;
  packets: number;
  bytes: number;
  tcpFlags: number;
  ingressIf: number;
  egressIf: number;
  samplingInterval: number;
}> {
  const readUIntBE = (b: Buffer) => (b.length <= 6 ? b.readUIntBE(0, b.length) : Number(b.readBigUInt64BE(0)));
  switch (type) {
    case 1: return { bytes: readUIntBE(value) };
    case 2: return { packets: readUIntBE(value) };
    case 4: return { protocol: value.length ? value.readUInt8(0) : undefined };
    case 6: return { tcpFlags: value.length ? value.readUInt8(0) : undefined };
    case 7: return { srcPort: value.length >= 2 ? value.readUInt16BE(0) : undefined };
    case 8: return value.length >= 4 ? { srcIp: ipv4ToString(value, 0) } : {};
    case 10: return { ingressIf: readUIntBE(value) };
    case 11: return { dstPort: value.length >= 2 ? value.readUInt16BE(0) : undefined };
    case 12: return value.length >= 4 ? { dstIp: ipv4ToString(value, 0) } : {};
    case 14: return { egressIf: readUIntBE(value) };
    case 34: return { samplingInterval: readUIntBE(value) };
    default:
      return {};
  }
}

export class NetflowReceiver {
  private socket: dgram.Socket | null = null;
  private templates = new Map<string, Template>(); // key: exporter|sourceId|templateId
  private exporters = new Map<string, ExporterCounters>();

  constructor(
    private cfg: FlowReceiverConfig,
    private emit: (f: FlowRecord) => void,
  ) {}

  private counters(ip: string): ExporterCounters {
    let c = this.exporters.get(ip);
    if (!c) {
      c = { exporter_ip: ip, protocol: "netflow", version: null, templates: 0, sampling_rate: this.cfg.sampling_rate, flows: 0, packets_dropped: 0 };
      this.exporters.set(ip, c);
    }
    return c;
  }

  listExporters(): ExporterCounters[] {
    return Array.from(this.exporters.values());
  }

  start(): void {
    const socket = dgram.createSocket("udp4");
    socket.on("error", (err) => {
      log.error("netflow", `Socket error: ${err.message}`, { error: String(err) });
    });
    socket.on("message", (msg, rinfo) => this.handleMessage(msg, rinfo.address));
    socket.bind(this.cfg.port, this.cfg.bind_address, () => {
      log.info("netflow", `Listening for NetFlow on ${this.cfg.bind_address}:${this.cfg.port}`);
    });
    this.socket = socket;
  }

  stop(): void {
    this.socket?.close();
    this.socket = null;
  }

  private allowed(ip: string): boolean {
    if (!this.cfg.allow_exporters.length) return true;
    return this.cfg.allow_exporters.includes(ip);
  }

  private handleMessage(buf: Buffer, exporterIp: string): void {
    if (!this.allowed(exporterIp)) return;
    if (buf.length < 4) return;
    const version = buf.readUInt16BE(0);
    const counters = this.counters(exporterIp);
    try {
      if (version === 5) {
        parseV5(buf, exporterIp, this.cfg, this.emit, counters);
      } else if (version === 9) {
        this.parseV9(buf, exporterIp, counters);
      } else {
        counters.packets_dropped += 1;
      }
    } catch (err) {
      counters.packets_dropped += 1;
      log.warn("netflow", "Failed to parse packet", { exporterIp, error: String(err) });
    }
  }

  private parseV9(buf: Buffer, exporterIp: string, counters: ExporterCounters): void {
    counters.version = "v9";
    if (buf.length < 20) return;
    const sourceId = buf.readUInt32BE(16);
    let offset = 20;
    while (offset + 4 <= buf.length) {
      const flowSetId = buf.readUInt16BE(offset);
      const length = buf.readUInt16BE(offset + 2);
      if (length < 4 || offset + length > buf.length) break;
      const body = buf.subarray(offset + 4, offset + length);

      if (flowSetId === 0) {
        this.parseV9TemplateSet(body, exporterIp, sourceId, false, counters);
      } else if (flowSetId === 1) {
        this.parseV9TemplateSet(body, exporterIp, sourceId, true, counters);
      } else if (flowSetId >= 256) {
        this.parseV9DataSet(body, flowSetId, exporterIp, sourceId, counters);
      }
      offset += length;
    }
  }

  private parseV9TemplateSet(body: Buffer, exporterIp: string, sourceId: number, isOption: boolean, counters: ExporterCounters): void {
    let o = 0;
    while (o + 4 <= body.length) {
      const templateId = body.readUInt16BE(o);
      if (isOption) {
        // Option template header differs (scope+option field counts); skip safely.
        if (o + 4 > body.length) break;
        const scopeLen = body.readUInt16BE(o + 2);
        const optLen = o + 4 + scopeLen <= body.length ? body.readUInt16BE(o + 4) : 0;
        const headerLen = 6;
        const totalFieldsBytes = scopeLen + optLen;
        o += headerLen + totalFieldsBytes;
        this.templates.set(`${exporterIp}|${sourceId}|${templateId}`, { fields: [], isOption: true });
        counters.templates = this.templates.size;
        continue;
      }
      const fieldCount = body.readUInt16BE(o + 2);
      o += 4;
      const fields: TemplateField[] = [];
      for (let i = 0; i < fieldCount && o + 4 <= body.length; i++, o += 4) {
        fields.push({ type: body.readUInt16BE(o), length: body.readUInt16BE(o + 2) });
      }
      this.templates.set(`${exporterIp}|${sourceId}|${templateId}`, { fields, isOption: false });
      counters.templates = this.templates.size;
    }
  }

  private parseV9DataSet(body: Buffer, templateId: number, exporterIp: string, sourceId: number, counters: ExporterCounters): void {
    const tmpl = this.templates.get(`${exporterIp}|${sourceId}|${templateId}`);
    if (!tmpl || tmpl.isOption || !tmpl.fields.length) return;
    const recordLen = tmpl.fields.reduce((sum, f) => sum + f.length, 0);
    if (recordLen === 0) return;
    let o = 0;
    while (o + recordLen <= body.length) {
      const values: Record<number, Buffer> = {};
      let fo = o;
      for (const field of tmpl.fields) {
        values[field.type] = body.subarray(fo, fo + field.length);
        fo += field.length;
      }
      const merged = Object.entries(values).reduce((acc, [type, value]) => {
        return { ...acc, ...fieldToPartial(Number(type), value) };
      }, {} as ReturnType<typeof fieldToPartial>);

      this.emit(
        normalizeFlow({
          ts: new Date(),
          exporterIp,
          protocolNum: merged.protocol ?? null,
          srcIp: merged.srcIp ?? null,
          dstIp: merged.dstIp ?? null,
          srcPort: merged.srcPort ?? null,
          dstPort: merged.dstPort ?? null,
          packets: merged.packets ?? 0,
          bytes: merged.bytes ?? 0,
          tcpFlags: merged.tcpFlags ?? null,
          samplingRate: this.cfg.sampling_rate ?? merged.samplingInterval ?? null,
          ingressIf: merged.ingressIf ?? null,
          egressIf: merged.egressIf ?? null,
          vantage: this.cfg.vantage,
          observationPoint: this.cfg.observation_point,
          source: "netflow",
        }),
      );
      counters.flows += 1;
      o += recordLen;
    }
  }
}
