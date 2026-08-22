/** Pure-TS SNMP v2c client over node:dgram: BER encode/decode, GET/GETNEXT/GETBULK. */
import dgram from "node:dgram";
import { log } from "../logger.js";
import type { SnmpTargetConfig, ReportedInterfaceMetric, ReportedProbe } from "../contract.js";

type OidNum = number[];

function parseOid(oid: string): OidNum {
  return oid.replace(/^\./, "").split(".").map(Number);
}
function oidToString(oid: OidNum): string {
  return oid.join(".");
}

/* ---------------- BER encoding ---------------- */
function encodeLength(len: number): Buffer {
  if (len < 128) return Buffer.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
}
function encodeInt(n: number): Buffer {
  if (n === 0) return Buffer.from([0]);
  const bytes: number[] = [];
  let v = n;
  const neg = v < 0;
  if (neg) v = v >>> 0;
  while (v > 0) { bytes.unshift(v & 0xff); v = Math.floor(v / 256); }
  if (bytes[0] & 0x80 && !neg) bytes.unshift(0);
  return Buffer.from(bytes);
}
function encodeOid(oid: OidNum): Buffer {
  const bytes: number[] = [];
  bytes.push(oid[0] * 40 + oid[1]);
  for (const sub of oid.slice(2)) {
    if (sub < 128) { bytes.push(sub); continue; }
    const chunk: number[] = [];
    let v = sub;
    chunk.unshift(v & 0x7f);
    v >>= 7;
    while (v > 0) { chunk.unshift((v & 0x7f) | 0x80); v >>= 7; }
    bytes.push(...chunk);
  }
  return Buffer.from(bytes);
}
function nullTlv(): Buffer { return tlv(0x05, Buffer.alloc(0)); }

function encodeVarbind(oid: string): Buffer {
  return tlv(0x30, Buffer.concat([tlv(0x06, encodeOid(parseOid(oid))), nullTlv()]));
}

function encodeSnmpMessage(opts: {
  community: string;
  pduType: number; // 0xa0 GET, 0xa1 GETNEXT, 0xa5 GETBULK
  requestId: number;
  errorStatus?: number;
  errorIndex?: number;
  nonRepeaters?: number;
  maxRepetitions?: number;
  oids: string[];
}): Buffer {
  const varbinds = tlv(0x30, Buffer.concat(opts.oids.map(encodeVarbind)));
  const pduBody = Buffer.concat([
    tlv(0x02, encodeInt(opts.requestId)),
    tlv(0x02, encodeInt(opts.errorStatus ?? opts.nonRepeaters ?? 0)),
    tlv(0x02, encodeInt(opts.errorIndex ?? opts.maxRepetitions ?? 0)),
    varbinds,
  ]);
  const pdu = tlv(opts.pduType, pduBody);
  const message = Buffer.concat([
    tlv(0x02, encodeInt(1)), // version 2c = 1
    tlv(0x04, Buffer.from(opts.community, "utf8")),
    pdu,
  ]);
  return tlv(0x30, message);
}

/* ---------------- BER decoding ---------------- */
type Ber = { tag: number; content: Buffer; next: number };
function readTlv(buf: Buffer, offset: number): Ber {
  const tag = buf[offset];
  const lenByte = buf[offset + 1];
  let pos = offset + 2;
  let len: number;
  if (lenByte & 0x80) {
    const n = lenByte & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) { len = (len << 8) | buf[pos]; pos++; }
  } else {
    len = lenByte;
  }
  const content = buf.subarray(pos, pos + len);
  return { tag, content, next: pos + len };
}
function decodeInt(buf: Buffer): number {
  let v = 0;
  for (const b of buf) v = (v << 8) | b;
  if (buf.length && (buf[0] & 0x80)) v -= 1 << (8 * buf.length);
  return v;
}
function decodeUint(buf: Buffer): number {
  let v = 0;
  for (const b of buf) v = v * 256 + b;
  return v;
}
function decodeOid(buf: Buffer): OidNum {
  if (!buf.length) return [];
  const out: number[] = [Math.floor(buf[0] / 40), buf[0] % 40];
  let val = 0;
  for (let i = 1; i < buf.length; i++) {
    val = (val << 7) | (buf[i] & 0x7f);
    if (!(buf[i] & 0x80)) { out.push(val); val = 0; }
  }
  return out;
}

type Varbind = { oid: string; tag: number; value: Buffer };

function decodeVarbinds(pduBody: Buffer): Varbind[] {
  const reqId = readTlv(pduBody, 0);
  const errStatus = readTlv(pduBody, reqId.next);
  const errIndex = readTlv(pduBody, errStatus.next);
  const varbindList = readTlv(pduBody, errIndex.next);
  const out: Varbind[] = [];
  let o = 0;
  const body = varbindList.content;
  while (o < body.length) {
    const seq = readTlv(body, o);
    const oidT = readTlv(seq.content, 0);
    const valT = readTlv(seq.content, oidT.next);
    out.push({ oid: oidToString(decodeOid(oidT.content)), tag: valT.tag, value: valT.content });
    o = seq.next;
  }
  return out;
}

function varbindValue(v: Varbind): { num: number | null; text: string | null } {
  switch (v.tag) {
    case 0x02: return { num: decodeInt(v.value), text: null }; // INTEGER
    case 0x41: return { num: decodeUint(v.value), text: null }; // Counter32
    case 0x42: return { num: decodeUint(v.value), text: null }; // Gauge32
    case 0x43: return { num: decodeUint(v.value), text: null }; // TimeTicks
    case 0x46: return { num: decodeUint(v.value), text: null }; // Counter64
    case 0x04: return { num: null, text: v.value.toString("utf8") }; // OCTET STRING
    default: return { num: null, text: v.value.toString("hex") };
  }
}

let requestIdCounter = 1;

function sendSnmp(target: string, community: string, message: Buffer, timeoutMs = 3000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const timer = setTimeout(() => { socket.close(); reject(new Error("snmp timeout")); }, timeoutMs);
    socket.once("message", (msg) => { clearTimeout(timer); socket.close(); resolve(msg); });
    socket.once("error", (err) => { clearTimeout(timer); socket.close(); reject(err); });
    socket.send(message, 161, target);
  });
}

export async function snmpGet(target: string, community: string, oids: string[]): Promise<Varbind[]> {
  const msg = encodeSnmpMessage({ community, pduType: 0xa0, requestId: requestIdCounter++, oids });
  const resp = await sendSnmp(target, community, msg);
  const outer = readTlv(resp, 0);
  const version = readTlv(outer.content, 0);
  const comm = readTlv(outer.content, version.next);
  const pdu = readTlv(outer.content, comm.next);
  return decodeVarbinds(pdu.content);
}

export async function snmpWalk(target: string, community: string, baseOid: string, maxRows = 256): Promise<Varbind[]> {
  const out: Varbind[] = [];
  let current = baseOid;
  for (let i = 0; i < maxRows; i++) {
    const msg = encodeSnmpMessage({ community, pduType: 0xa1, requestId: requestIdCounter++, oids: [current] });
    let resp: Buffer;
    try {
      resp = await sendSnmp(target, community, msg);
    } catch {
      break;
    }
    const outer = readTlv(resp, 0);
    const version = readTlv(outer.content, 0);
    const comm = readTlv(outer.content, version.next);
    const pdu = readTlv(outer.content, comm.next);
    const vbs = decodeVarbinds(pdu.content);
    if (!vbs.length) break;
    const vb = vbs[0];
    if (!vb.oid.startsWith(baseOid) || vb.tag === 0x80 /* noSuchObject-ish end */) break;
    out.push(vb);
    current = vb.oid;
  }
  return out;
}

const IF_OIDS = {
  ifDescr: "1.3.6.1.2.1.2.2.1.2",
  ifName: "1.3.6.1.2.1.31.1.1.1.1",
  ifAlias: "1.3.6.1.2.1.31.1.1.1.18",
  ifHighSpeed: "1.3.6.1.2.1.31.1.1.1.15",
  ifHCInOctets: "1.3.6.1.2.1.31.1.1.1.6",
  ifHCOutOctets: "1.3.6.1.2.1.31.1.1.1.10",
  ifInErrors: "1.3.6.1.2.1.2.2.1.14",
  ifOutDiscards: "1.3.6.1.2.1.2.2.1.19",
};

const lastCounters = new Map<string, { ts: number; in: number; out: number; err: number; disc: number }>();

export async function pollSnmpInterfaces(cfg: SnmpTargetConfig): Promise<ReportedInterfaceMetric[]> {
  if (cfg.version === "3") {
    log.warn("snmp", `SNMPv3 not supported yet, use 2c for ${cfg.target}`);
    return [];
  }
  const community = cfg.community ?? "public";
  const out: ReportedInterfaceMetric[] = [];
  try {
    const [names, ins, outs, errs, discs] = await Promise.all([
      snmpWalk(cfg.target, community, IF_OIDS.ifName),
      snmpWalk(cfg.target, community, IF_OIDS.ifHCInOctets),
      snmpWalk(cfg.target, community, IF_OIDS.ifHCOutOctets),
      snmpWalk(cfg.target, community, IF_OIDS.ifInErrors),
      snmpWalk(cfg.target, community, IF_OIDS.ifOutDiscards),
    ]);
    const now = Date.now();
    for (let i = 0; i < names.length; i++) {
      const name = varbindValue(names[i]).text ?? `if${i + 1}`;
      const inOctets = varbindValue(ins[i] ?? { oid: "", tag: 0, value: Buffer.alloc(0) }).num ?? 0;
      const outOctets = varbindValue(outs[i] ?? { oid: "", tag: 0, value: Buffer.alloc(0) }).num ?? 0;
      const errCount = varbindValue(errs[i] ?? { oid: "", tag: 0, value: Buffer.alloc(0) }).num ?? 0;
      const discCount = varbindValue(discs[i] ?? { oid: "", tag: 0, value: Buffer.alloc(0) }).num ?? 0;
      const key = `${cfg.target}|${name}`;
      const prev = lastCounters.get(key);
      lastCounters.set(key, { ts: now, in: inOctets, out: outOctets, err: errCount, disc: discCount });
      if (!prev) continue;
      out.push({
        interface_name: name,
        bucket_ts: new Date(now).toISOString(),
        rx_bytes: Math.max(0, inOctets - prev.in),
        tx_bytes: Math.max(0, outOctets - prev.out),
        rx_packets: 0,
        tx_packets: 0,
        errors: Math.max(0, errCount - prev.err),
        discards: Math.max(0, discCount - prev.disc),
        utilization_pct: null,
        source: "snmp",
      });
    }
  } catch (err) {
    log.warn("snmp", `Interface walk failed for ${cfg.target}`, { error: String(err) });
  }
  return out;
}

export async function pollSnmpScalars(cfg: SnmpTargetConfig): Promise<ReportedProbe[]> {
  if (cfg.version === "3") return [];
  if (!cfg.oids.length) return [];
  const community = cfg.community ?? "public";
  const ts = new Date().toISOString();
  try {
    const vbs = await snmpGet(cfg.target, community, cfg.oids.map((o) => o.oid));
    return vbs.map((vb, i) => {
      const { num, text } = varbindValue(vb);
      const def = cfg.oids[i];
      return {
        kind: "snmp" as const,
        target: cfg.target,
        metric: def?.metric ?? vb.oid,
        value: num,
        value_text: text,
        unit: def?.unit ?? null,
        status: "ok",
        ts,
      };
    });
  } catch (err) {
    log.warn("snmp", `Scalar GET failed for ${cfg.target}`, { error: String(err) });
    return [];
  }
}

export class SnmpPoller {
  private timers: NodeJS.Timeout[] = [];
  constructor(
    private targets: SnmpTargetConfig[],
    private emit: (metrics: ReportedInterfaceMetric[], probes: ReportedProbe[]) => void,
  ) {}

  start(): void {
    for (const target of this.targets) {
      if (!target.enabled) continue;
      const run = async () => {
        const metrics = target.poll_interfaces ? await pollSnmpInterfaces(target) : [];
        const probes = await pollSnmpScalars(target);
        this.emit(metrics, probes);
      };
      void run();
      const t = setInterval(() => void run(), Math.max(5, target.interval_seconds) * 1000);
      t.unref?.();
      this.timers.push(t);
    }
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }
}
