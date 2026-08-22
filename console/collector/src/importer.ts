/**
 * Watches the import/spool folder for pcap/pcapng/cap(.gz)/csv/json/log
 * files of arbitrary size, streams them into the store via tshark (packet
 * captures) or line readers (csv/json/log), honoring import_concurrency and
 * max_packets_per_import from capacity. Finished files move to done/ or
 * failed/ and a per-file event is emitted.
 */
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdirSync, readdirSync, renameSync, statSync, existsSync, unlinkSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { join, basename, extname } from "node:path";
import { log } from "./logger.js";
import { DATA_DIR } from "./config.js";
import type { CapacityLimits } from "./capacity.js";
import type { PacketRecord } from "./pipeline/normalize.js";
import type { FlowRecord } from "./pipeline/normalize.js";
import { normalizeFlow } from "./pipeline/normalize.js";

export const IMPORT_DIR = join(DATA_DIR, "import");
export const IMPORT_DONE_DIR = join(IMPORT_DIR, "done");
export const IMPORT_FAILED_DIR = join(IMPORT_DIR, "failed");

const PCAP_EXTS = new Set([".pcap", ".pcapng", ".cap"]);
const TEXT_EXTS = new Set([".csv", ".json", ".log", ".ndjson"]);

export type ImportEvent = {
  path: string;
  status: "started" | "done" | "failed";
  bytes_total: number;
  bytes_processed: number;
  packets_imported: number;
  error?: string;
  started_at: string;
  finished_at?: string;
};

export type ImporterDeps = {
  limits: () => CapacityLimits;
  emitPackets: (rows: PacketRecord[]) => void;
  emitFlows: (rows: FlowRecord[]) => void;
  onEvent: (event: ImportEvent) => void;
};

function isGz(path: string): boolean {
  return path.toLowerCase().endsWith(".gz");
}

function baseExt(path: string): string {
  const name = isGz(path) ? path.slice(0, -3) : path;
  return extname(name).toLowerCase();
}

/** Dissects a pcap/pcapng/cap file (optionally gzipped) with tshark into packet rows. */
async function importPacketFile(
  path: string,
  maxPackets: number,
  onRows: (rows: PacketRecord[]) => void,
): Promise<{ packets: number }> {
  let source = path;
  let cleanup: (() => void) | null = null;
  if (isGz(path)) {
    const tmp = join(DATA_DIR, "import", `.decompressed-${Date.now()}-${basename(path)}`.replace(/\.gz$/, ""));
    await new Promise<void>((resolve, reject) => {
      const input = createReadStream(path);
      const output = createWriteStream(tmp);
      input.pipe(createGunzip()).pipe(output);
      output.on("finish", resolve);
      output.on("error", reject);
      input.on("error", reject);
    });
    source = tmp;
    cleanup = () => { try { unlinkSync(tmp); } catch { /* ignore */ } };
  }

  try {
    const fields = [
      "frame.time_epoch", "ip.src", "ipv6.src", "ip.dst", "ipv6.dst", "frame.len",
      "tcp.srcport", "udp.srcport", "tcp.dstport", "udp.dstport", "ip.proto",
      "_ws.col.Protocol", "_ws.col.Info",
    ];
    const args = ["-r", source, "-n", "-T", "fields", "-E", "separator=\t", "-E", "header=n"];
    for (const f of fields) args.push("-e", f);
    if (maxPackets > 0) args.push("-c", String(maxPackets));

    return await new Promise((resolve, reject) => {
      const proc = spawn("tshark", args, { stdio: ["ignore", "pipe", "pipe"] });
      const rl = createInterface({ input: proc.stdout });
      let count = 0;
      let batch: PacketRecord[] = [];
      const vantage = "import";
      const observationPoint = basename(path);

      rl.on("line", (line) => {
        if (!line.trim()) return;
        const cols = line.split("\t");
        const [epoch, ip4src, ip6src, ip4dst, ip6dst, len, tsport, usport, tdport, udport, proto, protoName, info] = cols;
        const ts = epoch ? new Date(Number(epoch) * 1000).toISOString() : new Date().toISOString();
        batch.push({
          ts,
          interface_name: observationPoint,
          src_ip: ip4src || ip6src || null,
          dst_ip: ip4dst || ip6dst || null,
          src_port: tsport ? Number(tsport) : usport ? Number(usport) : null,
          dst_port: tdport ? Number(tdport) : udport ? Number(udport) : null,
          protocol: protoName || (proto ? `proto-${proto}` : null),
          length: len ? Number(len) : 0,
          info: info || null,
          vantage,
          observation_point: observationPoint,
        });
        count += 1;
        if (batch.length >= 5000) {
          onRows(batch);
          batch = [];
        }
      });
      let stderrText = "";
      proc.stderr?.on("data", (chunk) => { stderrText += String(chunk); });
      proc.on("error", reject);
      proc.on("exit", (code) => {
        if (batch.length) onRows(batch);
        if (code === 0 || count > 0) resolve({ packets: count });
        else reject(new Error(stderrText || `tshark exited with code ${code}`));
      });
    });
  } finally {
    cleanup?.();
  }
}

/** Reads a csv/json/ndjson/log file line by line and maps rows to flow records, tolerant of unknown shapes. */
async function importTextFile(
  path: string,
  onFlows: (rows: FlowRecord[]) => void,
): Promise<{ lines: number }> {
  const isJsonLike = baseExt(path) === ".json" || baseExt(path) === ".ndjson";
  const isCsv = baseExt(path) === ".csv";

  const rawStream = createReadStream(path);
  const stream = isGz(path) ? rawStream.pipe(createGunzip()) : rawStream;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let header: string[] | null = null;
  let count = 0;
  let batch: FlowRecord[] = [];
  const observationPoint = basename(path);

  const mapRow = (row: Record<string, unknown>): FlowRecord | null => {
    const srcIp = (row.src_ip ?? row.source_ip ?? row.srcAddr) as string | undefined;
    const dstIp = (row.dst_ip ?? row.destination_ip ?? row.dstAddr) as string | undefined;
    if (!srcIp && !dstIp) return null;
    const tsRaw = row.ts ?? row.timestamp ?? row.time;
    const ts = tsRaw ? new Date(tsRaw as string | number) : new Date();
    return normalizeFlow({
      ts: Number.isNaN(ts.getTime()) ? new Date() : ts,
      exporterIp: String(row.exporter_ip ?? "import"),
      protocolNum: row.protocol_number != null ? Number(row.protocol_number) : null,
      srcIp: srcIp ?? null,
      dstIp: dstIp ?? null,
      srcPort: row.src_port != null ? Number(row.src_port) : null,
      dstPort: row.dst_port != null ? Number(row.dst_port) : null,
      packets: Number(row.packets ?? 0),
      bytes: Number(row.bytes ?? 0),
      tcpFlags: row.tcp_flags != null ? Number(row.tcp_flags) : null,
      samplingRate: row.sampling_rate != null ? Number(row.sampling_rate) : null,
      ingressIf: null,
      egressIf: null,
      vantage: "import",
      observationPoint,
      source: "netflow",
    });
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    count += 1;
    try {
      if (isCsv) {
        const cells = line.split(",");
        if (!header) { header = cells.map((c) => c.trim()); continue; }
        const row: Record<string, unknown> = {};
        header.forEach((key, i) => { row[key] = cells[i]; });
        const flow = mapRow(row);
        if (flow) batch.push(flow);
      } else if (isJsonLike) {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const flow = mapRow(parsed);
        if (flow) batch.push(flow);
      }
      // Plain .log files are stored as events only, no flow mapping.
    } catch {
      // Skip malformed lines but keep importing the rest of the file.
    }
    if (batch.length >= 5000) {
      onFlows(batch);
      batch = [];
    }
  }
  if (batch.length) onFlows(batch);
  return { lines: count };
}

/** Watches import/ for new files and streams them into the store, one file per available concurrency slot. */
export class Importer {
  private timer: NodeJS.Timeout | null = null;
  private active = new Set<string>();
  private running = false;

  constructor(private deps: ImporterDeps) {
    mkdirSync(IMPORT_DIR, { recursive: true });
    mkdirSync(IMPORT_DONE_DIR, { recursive: true });
    mkdirSync(IMPORT_FAILED_DIR, { recursive: true });
  }

  start(): void {
    this.timer = setInterval(() => void this.scan(), 3_000);
    this.timer.unref?.();
    void this.scan();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Manually kick off a scan, e.g. from the local API's trigger-import endpoint. */
  triggerScan(): void {
    void this.scan();
  }

  private async scan(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (!existsSync(IMPORT_DIR)) return;
      const limits = this.deps.limits();
      const concurrency = Math.max(1, limits.import_concurrency || 1);
      const entries = readdirSync(IMPORT_DIR).filter((name) => {
        if (name === "done" || name === "failed" || name.startsWith(".")) return false;
        const ext = baseExt(name);
        return PCAP_EXTS.has(ext) || TEXT_EXTS.has(ext);
      });
      for (const name of entries) {
        if (this.active.size >= concurrency) break;
        const full = join(IMPORT_DIR, name);
        if (this.active.has(full)) continue;
        this.active.add(full);
        void this.importOne(full, limits).finally(() => this.active.delete(full));
      }
    } finally {
      this.running = false;
    }
  }

  private async importOne(path: string, limits: CapacityLimits): Promise<void> {
    const startedAt = new Date().toISOString();
    let bytesTotal = 0;
    try {
      bytesTotal = statSync(path).size;
    } catch {
      return; // file disappeared before we got to it
    }
    this.deps.onEvent({
      path,
      status: "started",
      bytes_total: bytesTotal,
      bytes_processed: 0,
      packets_imported: 0,
      started_at: startedAt,
    });
    log.info("importer", `Importing ${basename(path)}`, { bytes: bytesTotal });

    try {
      const ext = baseExt(path);
      let packetsImported = 0;
      if (PCAP_EXTS.has(ext)) {
        const result = await importPacketFile(path, limits.max_packets_per_import || 0, this.deps.emitPackets);
        packetsImported = result.packets;
      } else {
        const result = await importTextFile(path, this.deps.emitFlows);
        packetsImported = result.lines;
      }
      const dest = join(IMPORT_DONE_DIR, `${Date.now()}-${basename(path)}`);
      renameSync(path, dest);
      this.deps.onEvent({
        path,
        status: "done",
        bytes_total: bytesTotal,
        bytes_processed: bytesTotal,
        packets_imported: packetsImported,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
      log.info("importer", `Finished ${basename(path)}`, { packets: packetsImported });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("importer", `Import failed for ${basename(path)}`, { error: message });
      try {
        const dest = join(IMPORT_FAILED_DIR, `${Date.now()}-${basename(path)}`);
        renameSync(path, dest);
      } catch { /* file already moved or removed */ }
      this.deps.onEvent({
        path,
        status: "failed",
        bytes_total: bytesTotal,
        bytes_processed: 0,
        packets_imported: 0,
        error: message,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
    }
  }
}
