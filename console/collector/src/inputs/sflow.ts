import dgram from "node:dgram";
import { log } from "../logger.js";
import { normalizeFlow, type FlowRecord } from "../pipeline/normalize.js";
import type { FlowReceiverConfig } from "../contract.js";
import type { ExporterCounters } from "./netflow.js";

function ipv4ToString(buf: Buffer, offset: number): string {
  return `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
}

/** Minimal Ethernet/IPv4/TCP-UDP header parser for sFlow raw packet samples. */
function parseRawEthernet(pkt: Buffer): {
  srcIp: string | null; dstIp: string | null; srcPort: number | null; dstPort: number | null;
  protocol: number | null; tcpFlags: number | null;
} {
  if (pkt.length < 14) return { srcIp: null, dstIp: null, srcPort: null, dstPort: null, protocol: null, tcpFlags: null };
  let offset = 12;
  let etherType = pkt.readUInt16BE(offset);
  offset += 2;
  if (etherType === 0x8100) { // VLAN tag
    offset += 2;
    etherType = pkt.readUInt16BE(offset);
    offset += 2;
  }
  if (etherType !== 0x0800 || pkt.length < offset + 20) {
    return { srcIp: null, dstIp: null, srcPort: null, dstPort: null, protocol: null, tcpFlags: null };
  }
  const ipStart = offset;
  const ihl = (pkt.readUInt8(ipStart) & 0x0f) * 4;
  const protocol = pkt.readUInt8(ipStart + 9);
  const srcIp = ipv4ToString(pkt, ipStart + 12);
  const dstIp = ipv4ToString(pkt, ipStart + 16);
  const l4Start = ipStart + ihl;
  let srcPort: number | null = null;
  let dstPort: number | null = null;
  let tcpFlags: number | null = null;
  if ((protocol === 6 || protocol === 17) && pkt.length >= l4Start + 4) {
    srcPort = pkt.readUInt16BE(l4Start);
    dstPort = pkt.readUInt16BE(l4Start + 2);
    if (protocol === 6 && pkt.length >= l4Start + 14) tcpFlags = pkt.readUInt8(l4Start + 13);
  }
  return { srcIp, dstIp, srcPort, dstPort, protocol, tcpFlags };
}

export class SflowReceiver {
  private socket: dgram.Socket | null = null;
  private exporters = new Map<string, ExporterCounters>();

  constructor(
    private cfg: FlowReceiverConfig,
    private emit: (f: FlowRecord) => void,
  ) {}

  private counters(ip: string): ExporterCounters {
    let c = this.exporters.get(ip);
    if (!c) {
      c = { exporter_ip: ip, protocol: "sflow", version: "v5", templates: 0, sampling_rate: this.cfg.sampling_rate, flows: 0, packets_dropped: 0 };
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
    socket.on("error", (err) => log.error("sflow", `Socket error: ${err.message}`, { error: String(err) }));
    socket.on("message", (msg, rinfo) => this.handleMessage(msg, rinfo.address));
    socket.bind(this.cfg.port, this.cfg.bind_address, () => {
      log.info("sflow", `Listening for sFlow on ${this.cfg.bind_address}:${this.cfg.port}`);
    });
    this.socket = socket;
  }

  stop(): void {
    this.socket?.close();
    this.socket = null;
  }

  private handleMessage(buf: Buffer, exporterIp: string): void {
    if (!this.allowed(exporterIp)) return;
    const counters = this.counters(exporterIp);
    try {
      if (buf.length < 28) return;
      const version = buf.readUInt32BE(0);
      if (version !== 5) return;
      let o = 4;
      const addrType = buf.readUInt32BE(o);
      o += 4 + (addrType === 2 ? 16 : 4); // agent address
      o += 4; // sub-agent id
      const seq = buf.readUInt32BE(o); o += 4; void seq;
      const upTime = buf.readUInt32BE(o); o += 4; void upTime;
      const numSamples = buf.readUInt32BE(o); o += 4;

      for (let i = 0; i < numSamples && o + 8 <= buf.length; i++) {
        const sampleType = buf.readUInt32BE(o);
        const sampleLength = buf.readUInt32BE(o + 4);
        const sampleBody = buf.subarray(o + 8, o + 8 + sampleLength);
        if (sampleType === 1) this.parseFlowSample(sampleBody, exporterIp, counters);
        o += 8 + sampleLength;
      }
    } catch (err) {
      counters.packets_dropped += 1;
      log.warn("sflow", "Failed to parse datagram", { exporterIp, error: String(err) });
    }
  }

  private parseFlowSample(body: Buffer, exporterIp: string, counters: ExporterCounters): void {
    if (body.length < 24) return;
    let o = 0;
    o += 4; // sequence number
    o += 4; // source id
    const samplingRate = body.readUInt32BE(o); o += 4;
    o += 4; // sample pool
    o += 4; // drops
    o += 4; // input interface
    o += 4; // output interface
    const numRecords = body.readUInt32BE(o); o += 4;

    counters.sampling_rate = this.cfg.sampling_rate ?? samplingRate;

    for (let i = 0; i < numRecords && o + 8 <= body.length; i++) {
      const recordType = body.readUInt32BE(o);
      const recordLength = body.readUInt32BE(o + 4);
      const recordBody = body.subarray(o + 8, o + 8 + recordLength);
      if (recordType === 1 && recordBody.length >= 16) {
        // Raw packet header: protocol(4) frameLength(4) stripped(4) headerLength(4) header...
        const headerLength = recordBody.readUInt32BE(12);
        const header = recordBody.subarray(16, 16 + headerLength);
        const parsed = parseRawEthernet(header);
        this.emit(
          normalizeFlow({
            ts: new Date(),
            exporterIp,
            protocolNum: parsed.protocol,
            srcIp: parsed.srcIp,
            dstIp: parsed.dstIp,
            srcPort: parsed.srcPort,
            dstPort: parsed.dstPort,
            packets: 1,
            bytes: recordBody.readUInt32BE(4),
            tcpFlags: parsed.tcpFlags,
            samplingRate: counters.sampling_rate,
            ingressIf: null,
            egressIf: null,
            vantage: this.cfg.vantage,
            observationPoint: this.cfg.observation_point,
            source: "sflow",
          }),
        );
        counters.flows += 1;
      }
      o += 8 + recordLength;
    }
  }
}
