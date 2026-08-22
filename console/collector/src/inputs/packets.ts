/**
 * Live packet capture: dumpcap writes a ring buffer of pcapng files per
 * configured interface; a watcher dissects each closed ring file with
 * tshark into packet rows, honoring capacity limits and the shed stage.
 * child_process is fine here — this file runs under plain Node on the VM,
 * not the Cloudflare Worker restriction that applies to /dev-server/src.
 */
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../logger.js";
import { DATA_DIR } from "../config.js";
import type { CaptureInputConfig } from "../contract.js";
import type { CapacityLimits, DissectionDepth, CapacityGovernor } from "../capacity.js";
import type { PacketRecord } from "../pipeline/normalize.js";

const execFileAsync = promisify(execFile);
const RING_DIR = join(DATA_DIR, "ring");

function tsharkFieldsFor(depth: DissectionDepth): string[] {
  const base = ["frame.time_epoch", "ip.src", "ipv6.src", "ip.dst", "ipv6.dst", "frame.len"];
  const transport = ["tcp.srcport", "udp.srcport", "tcp.dstport", "udp.dstport", "ip.proto"];
  const application = ["_ws.col.Protocol", "_ws.col.Info"];
  if (depth === "off") return base;
  if (depth === "transport") return [...base, ...transport];
  return [...base, ...transport, ...application];
}

/** Runs tshark against a single completed ring file and yields packet rows. */
async function dissectFile(
  file: string,
  cfg: CaptureInputConfig,
  depth: DissectionDepth,
  maxPackets: number,
): Promise<PacketRecord[]> {
  const fields = tsharkFieldsFor(depth);
  const args = ["-r", file, "-n", "-T", "fields", "-E", "separator=\t", "-E", "header=n"];
  for (const f of fields) args.push("-e", f);
  if (maxPackets > 0) args.push("-c", String(maxPackets));

  const { stdout } = await execFileAsync("tshark", args, { maxBuffer: 512 * 1024 * 1024, timeout: 120_000 });
  const rows: PacketRecord[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    const [epoch, ip4src, ip6src, ip4dst, ip6dst, len, tsport, usport, tdport, udport, proto, protoName, info] = cols;
    const ts = epoch ? new Date(Number(epoch) * 1000).toISOString() : new Date().toISOString();
    rows.push({
      ts,
      interface_name: cfg.interface_name,
      src_ip: ip4src || ip6src || null,
      dst_ip: ip4dst || ip6dst || null,
      src_port: tsport ? Number(tsport) : usport ? Number(usport) : null,
      dst_port: tdport ? Number(tdport) : udport ? Number(udport) : null,
      protocol: protoName || (proto ? `proto-${proto}` : null),
      length: len ? Number(len) : 0,
      info: info || null,
      vantage: cfg.vantage,
      observation_point: cfg.observation_point,
    });
  }
  return rows;
}

export type PacketCaptureDeps = {
  limits: () => CapacityLimits;
  governor: CapacityGovernor;
  emit: (rows: PacketRecord[]) => void;
  recordCaptureBytes: (interfaceName: string, bytes: number, packets: number) => void;
};

/** One dumpcap process + ring-file watcher per configured capture interface. */
export class PacketCapture {
  private proc: ChildProcess | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private ringPrefix: string;
  private processing = new Set<string>();
  private windowStart = Date.now();
  private windowPackets = 0;

  constructor(private cfg: CaptureInputConfig, private deps: PacketCaptureDeps) {
    mkdirSync(RING_DIR, { recursive: true });
    this.ringPrefix = join(RING_DIR, cfg.interface_name.replace(/[^a-zA-Z0-9._-]/g, "_"));
  }

  start(): void {
    if (!this.cfg.enabled) return;
    const limits = this.deps.limits();
    const args = [
      "-i", this.cfg.interface_name,
      "-w", `${this.ringPrefix}.pcapng`,
      "-b", `filesize:${limits.ring_file_mb * 1024}`,
      "-b", `files:${limits.ring_files}`,
      "-s", String(limits.snaplen_bytes),
      "-q",
    ];
    if (this.cfg.promiscuous === false) args.push("-p");
    if (this.cfg.filter) args.push("-f", this.cfg.filter);

    log.info("packets", `Starting dumpcap on ${this.cfg.interface_name}`, { args });
    const proc = spawn("dumpcap", args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stderr?.on("data", (chunk) => log.debug("packets", `dumpcap[${this.cfg.interface_name}]`, { line: String(chunk).trim() }));
    proc.on("exit", (code, signal) => {
      log.warn("packets", `dumpcap exited for ${this.cfg.interface_name}`, { code, signal });
      this.proc = null;
    });
    this.proc = proc;

    this.pollTimer = setInterval(() => void this.scanRingFiles(), 2_000);
    this.pollTimer.unref?.();
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.proc?.kill();
    this.proc = null;
  }

  private async scanRingFiles(): Promise<void> {
    if (!existsSync(RING_DIR)) return;
    const now = Date.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.windowPackets = 0;
    }

    const prefixName = this.ringPrefix.split("/").pop() as string;
    const files = readdirSync(RING_DIR)
      .filter((f) => f.startsWith(prefixName) && f.endsWith(".pcapng"))
      .sort();
    if (files.length <= 1) return; // last file is the one dumpcap is actively writing

    const closed = files.slice(0, -1);
    const limits = this.deps.limits();
    for (const name of closed) {
      const full = join(RING_DIR, name);
      if (this.processing.has(full)) continue;
      this.processing.add(full);
      void this.processRingFile(full, limits).finally(() => this.processing.delete(full));
    }
  }

  private async processRingFile(full: string, limits: CapacityLimits): Promise<void> {
    let size = 0;
    try {
      size = statSync(full).size;
    } catch {
      return;
    }

    const stage = this.deps.governor.shedStage();
    const overBudget = limits.max_packets_per_second > 0 && this.windowPackets >= limits.max_packets_per_second;

    try {
      if (stage === "rollups_only" || stage === "sampled" || overBudget) {
        // Under pressure: skip per-packet dissection entirely, just account
        // for the bytes so interface metrics stay roughly accurate.
        const roughPackets = Math.max(1, Math.round(size / 350));
        this.deps.recordCaptureBytes(this.cfg.interface_name, size, roughPackets);
        log.info("packets", `Shed stage ${stage}: dropped ring file without dissection`, { file: full, size });
      } else {
        const depth = stage === "no_dissect" ? "transport" : limits.dissect_depth;
        const maxPackets = overBudget ? 0 : limits.max_packets_per_second || 0;
        const rows = await dissectFile(full, this.cfg, depth, maxPackets);
        this.windowPackets += rows.length;
        const bytes = rows.reduce((sum, r) => sum + r.length, 0);
        this.deps.recordCaptureBytes(this.cfg.interface_name, bytes, rows.length);
        if (rows.length) this.deps.emit(rows);
      }
    } catch (err) {
      log.warn("packets", `Failed to dissect ring file ${full}`, { error: String(err) });
    } finally {
      try { unlinkSync(full); } catch { /* already gone */ }
    }
  }
}

export class PacketCaptureManager {
  private captures: PacketCapture[] = [];
  constructor(private configs: CaptureInputConfig[], private deps: PacketCaptureDeps) {}

  start(): void {
    for (const cfg of this.configs) {
      if (!cfg.enabled) continue;
      const capture = new PacketCapture(cfg, this.deps);
      capture.start();
      this.captures.push(capture);
    }
  }

  stop(): void {
    for (const c of this.captures) c.stop();
    this.captures = [];
  }
}
