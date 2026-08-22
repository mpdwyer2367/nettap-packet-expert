import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { log } from "../logger.js";
import type { IcmpTargetConfig, ReportedProbe } from "../contract.js";

const execFileAsync = promisify(execFile);

function parsePing(platform: NodeJS.Platform, stdout: string): { min: number | null; avg: number | null; max: number | null; loss: number | null } {
  let min: number | null = null, avg: number | null = null, max: number | null = null, loss: number | null = null;
  const lossMatch = stdout.match(/(\d+(?:\.\d+)?)%\s*(?:packet)?\s*loss/i);
  if (lossMatch) loss = Number(lossMatch[1]);
  if (platform === "win32") {
    const m = stdout.match(/Minimum = (\d+)ms, Maximum = (\d+)ms, Average = (\d+)ms/i);
    if (m) { min = Number(m[1]); max = Number(m[2]); avg = Number(m[3]); }
  } else {
    const m = stdout.match(/= ([\d.]+)\/([\d.]+)\/([\d.]+)/);
    if (m) { min = Number(m[1]); avg = Number(m[2]); max = Number(m[3]); }
  }
  return { min, avg, max, loss };
}

export async function probeIcmp(cfg: IcmpTargetConfig): Promise<ReportedProbe[]> {
  const platform = os.platform();
  const args = platform === "win32"
    ? ["-n", String(cfg.count), "-w", String(cfg.timeout_ms), cfg.target]
    : platform === "darwin"
      ? ["-c", String(cfg.count), "-t", String(Math.ceil(cfg.timeout_ms / 1000)), cfg.target]
      : ["-c", String(cfg.count), "-W", String(Math.ceil(cfg.timeout_ms / 1000)), cfg.target];
  const bin = platform === "win32" ? "ping.exe" : "ping";
  const ts = new Date().toISOString();
  try {
    const { stdout } = await execFileAsync(bin, args, { timeout: cfg.timeout_ms * cfg.count + 5000 });
    const { min, avg, max, loss } = parsePing(platform, stdout);
    const status = loss != null && loss >= 100 ? "down" : "ok";
    const rows: ReportedProbe[] = [];
    const push = (metric: string, value: number | null, unit: string) =>
      rows.push({ kind: "icmp", target: cfg.target, metric, value, value_text: null, unit, status, ts });
    push("rtt_min_ms", min, "ms");
    push("rtt_avg_ms", avg, "ms");
    push("rtt_max_ms", max, "ms");
    push("loss_pct", loss, "%");
    return rows;
  } catch (err) {
    log.warn("icmp", `Ping failed for ${cfg.target}`, { error: String(err) });
    return [{ kind: "icmp", target: cfg.target, metric: "loss_pct", value: 100, value_text: null, unit: "%", status: "down", ts }];
  }
}

export class IcmpPoller {
  private timers: NodeJS.Timeout[] = [];
  constructor(private targets: IcmpTargetConfig[], private emit: (rows: ReportedProbe[]) => void) {}

  start(): void {
    for (const target of this.targets) {
      if (!target.enabled) continue;
      const run = () => void probeIcmp(target).then((rows) => this.emit(rows));
      run();
      const t = setInterval(run, Math.max(5, target.interval_seconds) * 1000);
      t.unref?.();
      this.timers.push(t);
    }
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }
}
