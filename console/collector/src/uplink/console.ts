/**
 * HMAC-signed check-in to the console's public collector endpoints
 * (/api/public/collector/heartbeat and /api/public/collector/uplink).
 *
 * Auth: `Authorization: Bearer <collector token>` plus `x-amdai-signature`,
 * an HMAC-SHA256 of the raw request body keyed by the token, matching
 * `signatureMatches` in the console's collector.server.ts.
 */
import { createHmac } from "node:crypto";
import os from "node:os";
import { log, drainRecentEvents } from "../logger.js";
import type {
  CollectorConfig,
  CollectorOs,
  CollectorStats,
  HeartbeatRequest,
  HeartbeatResponse,
  ReportedInterface,
  ReportedInterfaceMetric,
  ReportedFlowRollup,
  ReportedExporter,
  ReportedProbe,
  ReportedDeviceFact,
  UplinkRequest,
  UplinkResponse,
} from "../contract.js";
import { HEARTBEAT_SECONDS } from "../contract.js";

export type UplinkEnv = {
  consoleUrl: string;
  token: string;
};

function sign(token: string, raw: string): string {
  return createHmac("sha256", token).update(raw).digest("hex");
}

function detectOs(): CollectorOs {
  const platform = os.platform();
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  return "linux";
}

export type UplinkBatch = {
  interface_metrics?: ReportedInterfaceMetric[];
  flow_rollups?: ReportedFlowRollup[];
  exporters?: ReportedExporter[];
  probes?: ReportedProbe[];
  device_facts?: ReportedDeviceFact[];
  packets_ek?: string;
};

async function postSigned<TResp>(
  env: UplinkEnv,
  path: string,
  body: unknown,
): Promise<TResp> {
  const raw = JSON.stringify(body);
  const res = await fetch(`${env.consoleUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.token}`,
      "x-amdai-signature": sign(env.token, raw),
    },
    body: raw,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Console returned non-JSON response (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const message = (parsed as { error?: string })?.error ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  return parsed as TResp;
}

export type UplinkClientDeps = {
  version: string;
  hostname?: string;
  getStats: () => CollectorStats;
  getInterfaces: () => ReportedInterface[];
  getAppliedRevision: () => number;
  onConfig: (config: CollectorConfig, revision: number) => void;
};

/**
 * Owns the heartbeat/uplink loop: periodic check-ins push CapacityRuntime and
 * host stats and pull config revisions, while a separate cadence flushes
 * batched telemetry (interface metrics, rollups, exporters, probes, facts,
 * optional packet EK metadata).
 */
export class ConsoleUplink {
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private uplinkTimer: NodeJS.Timeout | null = null;
  private lastConfigRevision = -1;
  private batch: UplinkBatch = {};

  constructor(private env: UplinkEnv, private deps: UplinkClientDeps) {}

  start(uplinkBatchSeconds: number): void {
    const runHeartbeat = () => void this.heartbeat();
    runHeartbeat();
    this.heartbeatTimer = setInterval(runHeartbeat, HEARTBEAT_SECONDS * 1000);
    this.heartbeatTimer.unref?.();

    const runUplink = () => void this.flushUplink();
    this.uplinkTimer = setInterval(runUplink, Math.max(5, uplinkBatchSeconds) * 1000);
    this.uplinkTimer.unref?.();
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.uplinkTimer) clearInterval(this.uplinkTimer);
    this.heartbeatTimer = null;
    this.uplinkTimer = null;
  }

  /** Queues telemetry for the next uplink flush. Call from the pipeline as records become ready. */
  queue(batch: UplinkBatch): void {
    if (batch.interface_metrics?.length) {
      this.batch.interface_metrics = [...(this.batch.interface_metrics ?? []), ...batch.interface_metrics];
    }
    if (batch.flow_rollups?.length) {
      this.batch.flow_rollups = [...(this.batch.flow_rollups ?? []), ...batch.flow_rollups];
    }
    if (batch.exporters?.length) {
      this.batch.exporters = batch.exporters; // exporters is a point-in-time snapshot, replace rather than accumulate
    }
    if (batch.probes?.length) {
      this.batch.probes = [...(this.batch.probes ?? []), ...batch.probes];
    }
    if (batch.device_facts?.length) {
      this.batch.device_facts = [...(this.batch.device_facts ?? []), ...batch.device_facts];
    }
    if (batch.packets_ek) {
      this.batch.packets_ek = (this.batch.packets_ek ?? "") + batch.packets_ek;
    }
  }

  private async heartbeat(): Promise<void> {
    const request: HeartbeatRequest = {
      version: this.deps.version,
      hostname: this.deps.hostname ?? os.hostname(),
      os: detectOs(),
      applied_revision: this.deps.getAppliedRevision(),
      stats: this.deps.getStats(),
      interfaces: this.deps.getInterfaces(),
      events: drainRecentEvents(),
    };
    try {
      const response = await postSigned<HeartbeatResponse>(this.env, "/api/public/collector/heartbeat", request);
      if (response.config && response.config_revision !== this.lastConfigRevision) {
        this.lastConfigRevision = response.config_revision;
        this.deps.onConfig(response.config, response.config_revision);
      }
    } catch (err) {
      log.warn("uplink", "Heartbeat failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async flushUplink(): Promise<void> {
    const batch = this.batch;
    if (
      !batch.interface_metrics?.length &&
      !batch.flow_rollups?.length &&
      !batch.exporters?.length &&
      !batch.probes?.length &&
      !batch.device_facts?.length &&
      !batch.packets_ek
    ) {
      return;
    }
    this.batch = {};
    const request: UplinkRequest = { ...batch };
    try {
      const response = await postSigned<UplinkResponse>(this.env, "/api/public/collector/uplink", request);
      log.debug("uplink", "Batch accepted", { accepted: response.accepted });
    } catch (err) {
      log.warn("uplink", "Uplink batch failed, re-queueing", { error: err instanceof Error ? err.message : String(err) });
      // Put the failed batch back at the front so nothing is silently lost.
      this.queue(batch);
    }
  }
}
