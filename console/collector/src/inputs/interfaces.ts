import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { log } from "../logger.js";
import type { ReportedInterface, ReportedInterfaceMetric } from "../contract.js";

const execFileAsync = promisify(execFile);

type Counters = { rx_bytes: number; tx_bytes: number; rx_packets: number; tx_packets: number; errors: number; discards: number };

function linuxInterfaces(): ReportedInterface[] {
  const base = "/sys/class/net";
  if (!existsSync(base)) return [];
  return readdirSync(base).map((name) => {
    const read = (f: string) => {
      try { return readFileSync(`${base}/${name}/${f}`, "utf8").trim(); } catch { return null; }
    };
    const operstate = read("operstate");
    const speedRaw = read("speed");
    const speed = speedRaw && Number(speedRaw) > 0 ? Number(speedRaw) * 1_000_000 : null;
    return {
      name,
      description: null,
      mac: read("address"),
      addresses: [],
      link_speed_bps: speed,
      is_up: operstate === "up",
      is_loopback: name === "lo",
    } satisfies ReportedInterface;
  });
}

function linuxCounters(): Map<string, Counters> {
  const out = new Map<string, Counters>();
  try {
    const text = readFileSync("/proc/net/dev", "utf8");
    for (const line of text.split("\n").slice(2)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [ifacePart, rest] = trimmed.split(":");
      if (!rest) continue;
      const fields = rest.trim().split(/\s+/).map(Number);
      out.set(ifacePart.trim(), {
        rx_bytes: fields[0] ?? 0,
        rx_packets: fields[1] ?? 0,
        errors: (fields[2] ?? 0) + (fields[10] ?? 0),
        discards: (fields[3] ?? 0) + (fields[11] ?? 0),
        tx_bytes: fields[8] ?? 0,
        tx_packets: fields[9] ?? 0,
      });
    }
  } catch (err) {
    log.warn("interfaces", "Failed to read /proc/net/dev", { error: String(err) });
  }
  return out;
}

async function macInterfaces(): Promise<ReportedInterface[]> {
  try {
    const { stdout } = await execFileAsync("ifconfig", ["-a"]);
    const blocks = stdout.split(/\n(?=\S)/);
    const parsed: ReportedInterface[] = [];
    for (const block of blocks) {
      const nameMatch = block.match(/^(\S+):/);
      if (!nameMatch) continue;
      const name = nameMatch[1];
      const isUp = /<UP,/.test(block) || /flags=.*UP/.test(block);
      const macMatch = block.match(/ether ([0-9a-f:]+)/i);
      const addresses = Array.from(block.matchAll(/inet6?\s+([0-9a-fA-F:.]+)/g)).map((m) => m[1]);
      parsed.push({
        name,
        description: null,
        mac: macMatch ? macMatch[1] : null,
        addresses,
        link_speed_bps: null,
        is_up: isUp,
        is_loopback: name === "lo0",
      });
    }
    return parsed;

  } catch (err) {
    log.warn("interfaces", "ifconfig unavailable", { error: String(err) });
    return [];
  }
}

async function macCounters(): Promise<Map<string, Counters>> {
  const out = new Map<string, Counters>();
  try {
    const { stdout } = await execFileAsync("netstat", ["-ib"]);
    const lines = stdout.split("\n").slice(1);
    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 10) continue;
      const name = cols[0];
      const ipkts = Number(cols[4]);
      const ierrs = Number(cols[5]);
      const ibytes = Number(cols[6]);
      const opkts = Number(cols[7]);
      const oerrs = Number(cols[8]);
      const obytes = Number(cols[9]);
      if ([ipkts, ibytes, opkts, obytes].some(Number.isNaN)) continue;
      out.set(name, { rx_bytes: ibytes, rx_packets: ipkts, errors: (ierrs || 0) + (oerrs || 0), discards: 0, tx_bytes: obytes, tx_packets: opkts });
    }
  } catch (err) {
    log.warn("interfaces", "netstat -ib unavailable", { error: String(err) });
  }
  return out;
}

async function windowsInterfaces(): Promise<ReportedInterface[]> {
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile", "-Command",
      "Get-NetAdapter | Select-Object Name,MacAddress,LinkSpeed,Status | ConvertTo-Json -Compress",
    ]);
    const parsed = JSON.parse(stdout || "[]") as unknown;
    const rows: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    return rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object").map((r) => ({
      name: String(r.Name),
      description: null,
      mac: r.MacAddress ?? null,
      addresses: [],
      link_speed_bps: null,
      is_up: String(r.Status).toLowerCase() === "up",
      is_loopback: false,
    }));
  } catch (err) {
    log.warn("interfaces", "Get-NetAdapter unavailable", { error: String(err) });
    return [];
  }
}

async function windowsCounters(): Promise<Map<string, Counters>> {
  const out = new Map<string, Counters>();
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile", "-Command",
      "Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes,ReceivedUnicastPackets,SentUnicastPackets,ReceivedDiscardedPackets,OutboundDiscardedPackets | ConvertTo-Json -Compress",
    ]);
    const parsed = JSON.parse(stdout || "[]") as unknown;
    const rows: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      out.set(String(r.Name), {
        rx_bytes: Number(r.ReceivedBytes) || 0,
        tx_bytes: Number(r.SentBytes) || 0,
        rx_packets: Number(r.ReceivedUnicastPackets) || 0,
        tx_packets: Number(r.SentUnicastPackets) || 0,
        errors: 0,
        discards: (Number(r.ReceivedDiscardedPackets) || 0) + (Number(r.OutboundDiscardedPackets) || 0),
      });
    }
  } catch (err) {
    log.warn("interfaces", "Get-NetAdapterStatistics unavailable", { error: String(err) });
  }
  return out;
}

export async function listInterfaces(): Promise<ReportedInterface[]> {
  const platform = os.platform();
  if (platform === "linux") return linuxInterfaces();
  if (platform === "darwin") return macInterfaces();
  if (platform === "win32") return windowsInterfaces();
  return [];
}

async function readCounters(): Promise<Map<string, Counters>> {
  const platform = os.platform();
  if (platform === "linux") return linuxCounters();
  if (platform === "darwin") return macCounters();
  if (platform === "win32") return windowsCounters();
  return new Map();
}

/** Tracks 10s counter deltas per interface, falling back to capture-derived byte counts when OS counters are unavailable. */
export class InterfaceMetricsTracker {
  private last = new Map<string, { counters: Counters; ts: number }>();
  private captureFallback = new Map<string, { bytes: number; packets: number }>();

  /** Called by capture inputs when OS counters are missing, to derive rx bytes from what we actually saw. */
  recordCaptureBytes(interfaceName: string, bytes: number, packets: number): void {
    const cur = this.captureFallback.get(interfaceName) ?? { bytes: 0, packets: 0 };
    cur.bytes += bytes;
    cur.packets += packets;
    this.captureFallback.set(interfaceName, cur);
  }

  async sample(interfaces: ReportedInterface[]): Promise<ReportedInterfaceMetric[]> {
    const now = Date.now();
    const counters = await readCounters();
    const out: ReportedInterfaceMetric[] = [];
    for (const iface of interfaces) {
      const bucketTs = new Date(now).toISOString();
      const current = counters.get(iface.name);
      const prev = this.last.get(iface.name);
      if (current) {
        this.last.set(iface.name, { counters: current, ts: now });
        if (prev) {
          const dtSec = Math.max(1, (now - prev.ts) / 1000);
          const rxBytes = Math.max(0, current.rx_bytes - prev.counters.rx_bytes);
          const txBytes = Math.max(0, current.tx_bytes - prev.counters.tx_bytes);
          const util = iface.link_speed_bps
            ? Math.min(100, ((rxBytes + txBytes) * 8) / dtSec / iface.link_speed_bps * 100)
            : null;
          out.push({
            interface_name: iface.name,
            bucket_ts: bucketTs,
            rx_bytes: rxBytes,
            tx_bytes: txBytes,
            rx_packets: Math.max(0, current.rx_packets - prev.counters.rx_packets),
            tx_packets: Math.max(0, current.tx_packets - prev.counters.tx_packets),
            errors: Math.max(0, current.errors - prev.counters.errors),
            discards: Math.max(0, current.discards - prev.counters.discards),
            utilization_pct: util,
            source: "host",
          });
        }
      } else {
        const fallback = this.captureFallback.get(iface.name);
        if (fallback) {
          out.push({
            interface_name: iface.name,
            bucket_ts: bucketTs,
            rx_bytes: fallback.bytes,
            tx_bytes: 0,
            rx_packets: fallback.packets,
            tx_packets: 0,
            errors: 0,
            discards: 0,
            utilization_pct: null,
            source: "capture",
          });
          this.captureFallback.set(iface.name, { bytes: 0, packets: 0 });
        }
      }
    }
    return out;
  }
}
