/**
 * Polls a configured packet-broker / monitoring HTTP source for flow and log
 * data. Auth token may be given literally or as `env:VAR_NAME` to keep
 * secrets out of collector.json.
 */
import { log } from "../logger.js";
import { normalizeFlow, type FlowRecord } from "../pipeline/normalize.js";
import type { BrokerSourceConfig } from "../contract.js";

export type BrokerLogRow = { level: string; kind: string; message: string; extra?: Record<string, unknown> };

function resolveToken(token: string | undefined): string | null {
  if (!token) return null;
  if (token.startsWith("env:")) {
    const name = token.slice(4);
    const value = process.env[name];
    if (!value) log.warn("broker", `Secret env var ${name} is not set`);
    return value ?? null;
  }
  return token;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : v == null ? null : String(v);
}

/** Best-effort mapping of a broker's JSON row into our flow shape, tolerant of common field-name variants. */
function mapRowToFlow(row: Record<string, unknown>, cfg: BrokerSourceConfig): FlowRecord | null {
  const srcIp = str(row.src_ip ?? row.source_ip ?? row.srcAddr ?? row.sourceAddress);
  const dstIp = str(row.dst_ip ?? row.destination_ip ?? row.dstAddr ?? row.destinationAddress);
  if (!srcIp && !dstIp) return null;
  const tsRaw = row.ts ?? row.timestamp ?? row.time;
  const ts = tsRaw ? new Date(tsRaw as string | number) : new Date();
  return normalizeFlow({
    ts: Number.isNaN(ts.getTime()) ? new Date() : ts,
    exporterIp: str(row.exporter_ip ?? row.sensor ?? cfg.name) ?? cfg.name,
    protocolNum: num(row.protocol_number ?? row.proto),
    srcIp,
    dstIp,
    srcPort: num(row.src_port ?? row.sourcePort),
    dstPort: num(row.dst_port ?? row.destinationPort),
    packets: num(row.packets) ?? 0,
    bytes: num(row.bytes) ?? 0,
    tcpFlags: num(row.tcp_flags),
    samplingRate: num(row.sampling_rate),
    ingressIf: num(row.ingress_if),
    egressIf: num(row.egress_if),
    vantage: "broker",
    observationPoint: cfg.name,
    source: "netflow",
  });
}

export class BrokerPoller {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private cfg: BrokerSourceConfig,
    private emit: (flows: FlowRecord[], logs: BrokerLogRow[]) => void,
  ) {}

  start(): void {
    if (!this.cfg.enabled) return;
    const run = () => void this.poll();
    run();
    this.timer = setInterval(run, Math.max(5, this.cfg.interval_seconds) * 1000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    const url = `${this.cfg.base_url.replace(/\/+$/, "")}${this.cfg.resource}`;
    const token = resolveToken(this.cfg.token);
    const headers: Record<string, string> = {};
    if (token && this.cfg.auth_header) headers[this.cfg.auth_header] = token;
    else if (token) headers.Authorization = `Bearer ${token}`;

    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        this.emit([], [{ level: "warn", kind: "broker", message: `${this.cfg.name}: HTTP ${res.status}` }]);
        return;
      }
      const body = (await res.json()) as unknown;
      const wrappedData =
        body && typeof body === "object" && "data" in body
          ? (body as { data?: unknown }).data
          : undefined;
      const rows = Array.isArray(body) ? body : Array.isArray(wrappedData) ? wrappedData : [];
      const flows: FlowRecord[] = [];
      const logs: BrokerLogRow[] = [];
      for (const raw of rows) {
        if (raw && typeof raw === "object") {
          const flow = mapRowToFlow(raw as Record<string, unknown>, this.cfg);
          if (flow) flows.push(flow);
          else logs.push({ level: "info", kind: "broker-raw", message: `${this.cfg.name}: unmapped row`, extra: raw as Record<string, unknown> });
        }
      }
      this.emit(flows, logs);
    } catch (err) {
      log.warn("broker", `Poll failed for ${this.cfg.name}`, { error: String(err) });
      this.emit([], [{ level: "warn", kind: "broker", message: `${this.cfg.name}: ${String(err)}` }]);
    }
  }
}
