/**
 * Cross-platform device fact collection: local routes/ARP/DNS/listening
 * sockets, plus reads against remote devices configured via
 * `DeviceReadConfig` (SSH command execution or SNMP walks).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { log } from "../logger.js";
import { snmpWalk } from "./snmp.js";
import type { DeviceReadConfig, ReportedDeviceFact } from "../contract.js";

const execFileAsync = promisify(execFile);

async function tryExec(bin: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(bin, args, { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    log.debug("devices", `${bin} ${args.join(" ")} failed`, { error: String(err) });
    return null;
  }
}

async function linuxRoutes(): Promise<string | null> {
  return (await tryExec("ip", ["route", "show"])) ?? (await tryExec("netstat", ["-rn"]));
}
async function linuxNeighbors(): Promise<string | null> {
  return (await tryExec("ip", ["neigh", "show"])) ?? (await tryExec("arp", ["-an"]));
}
async function linuxSockets(): Promise<string | null> {
  return (await tryExec("ss", ["-tulnp"])) ?? (await tryExec("netstat", ["-tulnp"]));
}
async function macRoutes(): Promise<string | null> {
  return tryExec("netstat", ["-rn"]);
}
async function macNeighbors(): Promise<string | null> {
  return tryExec("arp", ["-an"]);
}
async function macSockets(): Promise<string | null> {
  return tryExec("netstat", ["-anv", "-p", "tcp"]);
}
async function winRoutes(): Promise<string | null> {
  return tryExec("route.exe", ["print"]);
}
async function winNeighbors(): Promise<string | null> {
  return tryExec("arp.exe", ["-a"]);
}
async function winSockets(): Promise<string | null> {
  return tryExec("netstat.exe", ["-ano"]);
}

async function dnsConfig(): Promise<string | null> {
  const platform = os.platform();
  if (platform === "win32") {
    return tryExec("powershell.exe", [
      "-NoProfile", "-Command",
      "Get-DnsClientServerAddress | ConvertTo-Json -Compress",
    ]);
  }
  try {
    const fs = await import("node:fs");
    return fs.readFileSync("/etc/resolv.conf", "utf8");
  } catch (err) {
    log.debug("devices", "Failed to read /etc/resolv.conf", { error: String(err) });
    return null;
  }
}

/** Collects local host facts (this collector's own network state), tagged with the host's own name. */
export async function collectLocalDeviceFacts(): Promise<ReportedDeviceFact[]> {
  const platform = os.platform();
  const host = os.hostname();
  const collected_at = new Date().toISOString();

  const [routes, neighbors, sockets, dns] = await Promise.all([
    platform === "win32" ? winRoutes() : platform === "darwin" ? macRoutes() : linuxRoutes(),
    platform === "win32" ? winNeighbors() : platform === "darwin" ? macNeighbors() : linuxNeighbors(),
    platform === "win32" ? winSockets() : platform === "darwin" ? macSockets() : linuxSockets(),
    dnsConfig(),
  ]);

  const facts: ReportedDeviceFact[] = [];
  const push = (kind: string, summary: string, content: string | null) => {
    if (content == null) return;
    // Local host facts don't come from SNMP or SSH; "ssh" is the closer of
    // the two contract-defined sources (local shell execution), so we tag
    // it that way and let `kind` carry the real distinction.
    facts.push({ host, source: "ssh", kind: `local:${kind}`, summary, content, collected_at });
  };
  push("routes", "Routing table", routes);
  push("neighbors", "ARP/neighbor table", neighbors);
  push("sockets", "Listening sockets", sockets);
  push("dns", "DNS resolver configuration", dns);
  return facts;
}

async function readViaSsh(cfg: DeviceReadConfig): Promise<ReportedDeviceFact[]> {
  const collected_at = new Date().toISOString();
  const facts: ReportedDeviceFact[] = [];
  const sshArgs = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8"];
  const target = cfg.username ? `${cfg.username}@${cfg.host}` : cfg.host;
  for (const command of cfg.commands) {
    try {
      const { stdout } = await execFileAsync("ssh", [...sshArgs, target, command], {
        timeout: 20_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      facts.push({
        host: cfg.host,
        source: "ssh",
        kind: `ssh:${command}`,
        summary: `Output of \`${command}\``,
        content: stdout,
        collected_at,
      });
    } catch (err) {
      log.warn("devices", `SSH command failed on ${cfg.host}`, { command, error: String(err) });
    }
  }
  return facts;
}

async function readViaSnmp(cfg: DeviceReadConfig): Promise<ReportedDeviceFact[]> {
  const collected_at = new Date().toISOString();
  const facts: ReportedDeviceFact[] = [];
  const community = cfg.password || "public";
  for (const walk of cfg.walks) {
    try {
      const rows = await snmpWalk(cfg.host, community, walk);
      facts.push({
        host: cfg.host,
        source: "snmp",
        kind: `snmp-walk:${walk}`,
        summary: `${rows.length} varbind(s) under ${walk}`,
        content: JSON.stringify(rows.map((r) => ({ oid: r.oid, tag: r.tag, hex: r.value.toString("hex") }))),
        collected_at,
      });
    } catch (err) {
      log.warn("devices", `SNMP walk failed on ${cfg.host}`, { oid: walk, error: String(err) });
    }
  }
  return facts;
}

export class DeviceReader {
  private timers: NodeJS.Timeout[] = [];
  constructor(
    private configs: DeviceReadConfig[],
    private emit: (facts: ReportedDeviceFact[]) => void,
    private localIntervalMinutes = 15,
  ) {}

  start(): void {
    const runLocal = () => void collectLocalDeviceFacts().then((facts) => facts.length && this.emit(facts));
    runLocal();
    const localTimer = setInterval(runLocal, this.localIntervalMinutes * 60_000);
    localTimer.unref?.();
    this.timers.push(localTimer);

    for (const cfg of this.configs) {
      if (!cfg.enabled) continue;
      const run = () => {
        const task = cfg.source === "snmp" ? readViaSnmp(cfg) : readViaSsh(cfg);
        void task.then((facts) => facts.length && this.emit(facts));
      };
      run();
      const t = setInterval(run, Math.max(1, cfg.interval_minutes) * 60_000);
      t.unref?.();
      this.timers.push(t);
    }
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }
}
