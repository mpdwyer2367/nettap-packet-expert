/**
 * Windows device polling via PowerShell (Get-CimInstance / Get-WinEvent).
 * No-ops with a clear log line on any non-Windows host, since WMI/CIM is a
 * Windows-only surface.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { log } from "../logger.js";
import type { WmiTargetConfig, ReportedDeviceFact } from "../contract.js";

const execFileAsync = promisify(execFile);

function psCredentialArgs(cfg: WmiTargetConfig): string {
  if (!cfg.username) return "";
  // Password is passed via an env var the child process reads, so it never
  // appears in argv/process listings.
  return `
$sec = ConvertTo-SecureString $env:AMDAI_WMI_PASSWORD -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential('${cfg.username.replace(/'/g, "''")}', $sec)
`;
}

async function runCimQuery(cfg: WmiTargetConfig, wql: string): Promise<unknown[]> {
  const script = `
${psCredentialArgs(cfg)}
$params = @{ Query = '${wql.replace(/'/g, "''")}'; ComputerName = '${cfg.target.replace(/'/g, "''")}' }
if ($cred) { $params['Credential'] = $cred }
if (${cfg.use_https ? "$true" : "$false"}) { $params['Protocol'] = 'Wsman' }
try {
  Get-CimInstance @params | ConvertTo-Json -Compress -Depth 4
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`;
  const env = { ...process.env };
  if (cfg.password) env.AMDAI_WMI_PASSWORD = cfg.password;
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { env, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** Pulls a handful of recent system/application event log entries for the target. */
async function runWinEventQuery(cfg: WmiTargetConfig): Promise<unknown[]> {
  const script = `
${psCredentialArgs(cfg)}
$params = @{ ComputerName = '${cfg.target.replace(/'/g, "''")}'; LogName = 'System'; MaxEvents = 20 }
if ($cred) { $params['Credential'] = $cred }
try {
  Get-WinEvent @params | Select-Object TimeCreated, Id, LevelDisplayName, ProviderName, Message | ConvertTo-Json -Compress -Depth 3
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`;
  const env = { ...process.env };
  if (cfg.password) env.AMDAI_WMI_PASSWORD = cfg.password;
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { env, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

export async function pollWmiTarget(cfg: WmiTargetConfig): Promise<ReportedDeviceFact[]> {
  if (os.platform() !== "win32") {
    log.info("wmi", `Skipping WMI target ${cfg.target}: collector is not running on Windows`);
    return [];
  }
  const collected_at = new Date().toISOString();
  const facts: ReportedDeviceFact[] = [];

  for (const query of cfg.queries) {
    try {
      const rows = await runCimQuery(cfg, query.wql);
      facts.push({
        host: cfg.target,
        source: "ssh",
        kind: `wmi:${query.name}`,
        summary: `${rows.length} row(s) from ${query.name}`,
        content: JSON.stringify(rows),
        collected_at,
      });
    } catch (err) {
      log.warn("wmi", `CIM query '${query.name}' failed for ${cfg.target}`, { error: String(err) });
    }
  }

  try {
    const events = await runWinEventQuery(cfg);
    if (events.length) {
      facts.push({
        host: cfg.target,
        source: "ssh",
        kind: "wmi:winevent",
        summary: `${events.length} recent System event(s)`,
        content: JSON.stringify(events),
        collected_at,
      });
    }
  } catch (err) {
    log.warn("wmi", `Get-WinEvent failed for ${cfg.target}`, { error: String(err) });
  }

  return facts;
}

export class WmiPoller {
  private timers: NodeJS.Timeout[] = [];
  constructor(private targets: WmiTargetConfig[], private emit: (facts: ReportedDeviceFact[]) => void) {}

  start(): void {
    if (os.platform() !== "win32" && this.targets.some((t) => t.enabled)) {
      log.info("wmi", "WMI targets configured but collector host is not Windows; WMI polling disabled");
    }
    for (const target of this.targets) {
      if (!target.enabled) continue;
      const run = () => void pollWmiTarget(target).then((facts) => facts.length && this.emit(facts));
      run();
      const t = setInterval(run, Math.max(30, target.interval_seconds) * 1000);
      t.unref?.();
      this.timers.push(t);
    }
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }
}
