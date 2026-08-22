/**
 * Supervisor: loads config, migrates the local store, detects host
 * resources, and starts the capacity governor plus every input, the
 * importer, the console uplink and the local API. Each input runs behind a
 * restart-with-backoff wrapper so one crashing poller doesn't take down the
 * appliance, and SIGINT/SIGTERM trigger an orderly shutdown.
 */
import { loadEnv, loadConfig, saveConfig, DATA_DIR } from "./config.js";
import { log } from "./logger.js";
import { PgStore, type BatchWriter } from "./store/pg.js";
import {
  CapacityGovernor,
  detectHostResources,
  type CapacityTransition,
  type HostResources,
} from "./capacity.js";
import type { CollectorConfig, ReportedInterface } from "./contract.js";
import { normalizeConfig } from "./contract.js";
import { NetflowReceiver } from "./inputs/netflow.js";
import { IpfixReceiver } from "./inputs/ipfix.js";
import { SflowReceiver } from "./inputs/sflow.js";
import type { ExporterCounters } from "./inputs/netflow.js";
import { IcmpPoller } from "./inputs/icmp.js";
import { SnmpPoller } from "./inputs/snmp.js";
import { WmiPoller } from "./inputs/wmi.js";
import { DeviceReader } from "./inputs/devices.js";
import { BrokerPoller } from "./inputs/broker.js";
import { listInterfaces, InterfaceMetricsTracker } from "./inputs/interfaces.js";
import { PacketCaptureManager } from "./inputs/packets.js";
import { RollupEngine } from "./pipeline/rollup.js";
import type { FlowRecord, PacketRecord } from "./pipeline/normalize.js";
import { Importer } from "./importer.js";
import { ConsoleUplink } from "./uplink/console.js";
import { LocalApiServer } from "./api/server.js";

const VERSION = "0.1.0";

/** Runs `start()`/`stop()` on demand and restarts a failed input with exponential backoff. */
class Supervised {
  private stopped = false;
  private attempt = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private name: string,
    private factory: () => { start: () => void; stop: () => void },
    private instance: { start: () => void; stop: () => void } = factory(),
  ) {}

  start(): void {
    this.stopped = false;
    this.launch();
  }

  private launch(): void {
    try {
      this.instance.start();
      this.attempt = 0;
    } catch (err) {
      this.scheduleRestart(err);
    }
  }

  private scheduleRestart(err: unknown): void {
    if (this.stopped) return;
    this.attempt += 1;
    const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(this.attempt, 5));
    log.error("supervisor", `${this.name} failed, restarting in ${delayMs}ms`, {
      error: err instanceof Error ? err.message : String(err),
      attempt: this.attempt,
    });
    this.timer = setTimeout(() => {
      this.instance = this.factory();
      this.launch();
    }, delayMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      this.instance.stop();
    } catch (err) {
      log.warn("supervisor", `${this.name} stop() threw`, { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const env = loadEnv();
  let config: CollectorConfig = loadConfig();

  if (!env.consoleUrl || !env.token) {
    log.warn("startup", "AMDAI_CONSOLE_URL/AMDAI_COLLECTOR_TOKEN not set; running with uplink disabled");
  }

  const store = new PgStore(env.localPg);
  const migration = await store.migrate(config.capacity);
  log.info("startup", "Local store ready", migration);

  const host: HostResources = await detectHostResources(DATA_DIR);
  log.info("startup", "Detected host resources", host);

  const capacityEventsWriter = store.newBatchWriter("capacity_events", {
    batchRows: 100,
    flushIntervalMs: 2_000,
    spoolMaxGb: 1,
  });

  const governor = new CapacityGovernor(config.capacity, (t: CapacityTransition) => {
    log.warn("capacity", `Shed stage ${t.from} -> ${t.to}`, { reason: t.reason });
    capacityEventsWriter.push({ ts: t.at, from_stage: t.from, to_stage: t.to, reason: t.reason });
  });
  governor.setHost(host);

  const packetsWriter = store.newBatchWriter(
    "packets",
    { batchRows: config.capacity.copy_batch_rows, flushIntervalMs: config.capacity.flush_interval_ms, spoolMaxGb: config.capacity.spool_max_gb },
    (depth) => governor.sample({ ...lastSample(), queue_depth: depth }),
  );
  const flowsWriter = store.newBatchWriter("flows", {
    batchRows: config.capacity.copy_batch_rows,
    flushIntervalMs: config.capacity.flush_interval_ms,
    spoolMaxGb: config.capacity.spool_max_gb,
  });
  const flowRollupsWriter = store.newBatchWriter("flow_rollups", {
    batchRows: config.capacity.copy_batch_rows,
    flushIntervalMs: config.capacity.flush_interval_ms,
    spoolMaxGb: config.capacity.spool_max_gb,
  });
  const interfaceMetricsWriter = store.newBatchWriter("interface_metrics", {
    batchRows: 5_000,
    flushIntervalMs: config.capacity.flush_interval_ms,
    spoolMaxGb: 1,
  });
  const probeResultsWriter = store.newBatchWriter("probe_results", { batchRows: 5_000, flushIntervalMs: 2_000, spoolMaxGb: 1 });
  const deviceFactsWriter = store.newBatchWriter("device_facts", { batchRows: 1_000, flushIntervalMs: 2_000, spoolMaxGb: 1 });
  const importsWriter = store.newBatchWriter("imports", { batchRows: 100, flushIntervalMs: 2_000, spoolMaxGb: 1 });

  await Promise.all(
    [packetsWriter, flowsWriter, flowRollupsWriter, interfaceMetricsWriter, probeResultsWriter, deviceFactsWriter, importsWriter].map(
      (w: BatchWriter) => w.replaySpool(),
    ),
  );

  const rollup = new RollupEngine();
  const interfaceTracker = new InterfaceMetricsTracker();

  let flowsPerSecondWindow = 0;
  let flowsPerSecondCount = 0;
  let packetsPerSecondCount = 0;
  let windowStart = Date.now();
  let flowsTotal = 0;
  let packetsTotal = 0;
  const droppedTotal = 0;

  function lastSample() {
    return {
      flows_per_second: flowsPerSecondWindow,
      packets_per_second: packetsPerSecondCount,
      queue_depth: rollup.rawQueueDepth(),
      dropped_total: droppedTotal + rollup.droppedTotal(),
    };
  }

  function ingestFlow(flow: FlowRecord): void {
    rollup.ingest(flow);
    flowsPerSecondCount += 1;
    flowsTotal += 1;
  }
  function ingestFlows(flows: FlowRecord[]): void {
    for (const f of flows) ingestFlow(f);
  }
  function ingestPackets(rows: PacketRecord[]): void {
    for (const row of rows) packetsWriter.push(row as unknown as Record<string, unknown>);
    packetsPerSecondCount += rows.length;
    packetsTotal += rows.length;
  }

  setInterval(() => {
    const now = Date.now();
    const dtSec = Math.max(1, (now - windowStart) / 1000);
    flowsPerSecondWindow = flowsPerSecondCount / dtSec;
    windowStart = now;
    flowsPerSecondCount = 0;
    packetsPerSecondCount = 0;
    governor.setDbStats(0, store.writeLagMs());
    governor.setSpoolBytes(
      packetsWriter.spoolBytes() +
        flowsWriter.spoolBytes() +
        flowRollupsWriter.spoolBytes() +
        interfaceMetricsWriter.spoolBytes(),
    );
    governor.sample(lastSample());
  }, 1_000).unref?.();

  setInterval(async () => {
    for (const flow of rollup.drainRaw()) flowsWriter.push(flow as unknown as Record<string, unknown>);
    const rollups = rollup.drainCompletedRollups();
    for (const r of rollups) flowRollupsWriter.push(r as unknown as Record<string, unknown>);
    if (uplink && rollups.length) uplink.queue({ flow_rollups: rollups });
    try {
      governor.setDbStats(await store.dbSizeBytes(), store.writeLagMs());
    } catch { /* best-effort */ }
  }, Math.max(5, config.capacity.rollup_seconds / 4) * 1000).unref?.();

  // --- History jobs: rollup, retention cleanup, partition maintenance ----
  const runHistoryJobs = async (): Promise<void> => {
    await store.runRollupJob(config.capacity.raw_packet_hours);
    await store.runRetentionJob(config.capacity);
  };
  setInterval(() => void store.ensureUpcomingPartitions(2), 6 * 3_600_000).unref?.();
  setInterval(() => void runHistoryJobs(), 3_600_000).unref?.();
  void store.ensureUpcomingPartitions(2).then(() => runHistoryJobs());

  // --- Flow receivers -------------------------------------------------
  const flowInputs: { name: string; supervised: Supervised; listExporters: () => ExporterCounters[] }[] = [];
  for (const cfg of config.flow_receivers) {
    if (!cfg.enabled) continue;
    if (cfg.protocol === "netflow") {
      const receiver = new NetflowReceiver(cfg, ingestFlow);
      flowInputs.push({ name: "netflow", supervised: new Supervised("netflow", () => receiver, receiver), listExporters: () => receiver.listExporters() });
    } else if (cfg.protocol === "ipfix") {
      const receiver = new IpfixReceiver(cfg, ingestFlow);
      flowInputs.push({ name: "ipfix", supervised: new Supervised("ipfix", () => receiver, receiver), listExporters: () => receiver.listExporters() });
    } else if (cfg.protocol === "sflow") {
      const receiver = new SflowReceiver(cfg, ingestFlow);
      flowInputs.push({ name: "sflow", supervised: new Supervised("sflow", () => receiver, receiver), listExporters: () => receiver.listExporters() });
    }
  }

  // --- Packet capture ---------------------------------------------------
  const packetCapture = new PacketCaptureManager(config.captures, {
    limits: () => config.capacity,
    governor,
    emit: ingestPackets,
    recordCaptureBytes: (name, bytes, packets) => interfaceTracker.recordCaptureBytes(name, bytes, packets),
  });

  // --- Probes -------------------------------------------------------
  const icmp = new IcmpPoller(config.icmp, (rows) => {
    for (const r of rows) probeResultsWriter.push(r as unknown as Record<string, unknown>);
    uplink?.queue({ probes: rows });
  });
  const snmp = new SnmpPoller(config.snmp, (metrics, probes) => {
    for (const m of metrics) interfaceMetricsWriter.push(m as unknown as Record<string, unknown>);
    for (const p of probes) probeResultsWriter.push(p as unknown as Record<string, unknown>);
    uplink?.queue({ interface_metrics: metrics, probes });
  });
  const wmi = new WmiPoller(config.wmi, (facts) => {
    for (const f of facts) deviceFactsWriter.push(f as unknown as Record<string, unknown>);
    uplink?.queue({ device_facts: facts });
  });
  const devices = new DeviceReader(config.devices, (facts) => {
    for (const f of facts) deviceFactsWriter.push(f as unknown as Record<string, unknown>);
    uplink?.queue({ device_facts: facts });
  });
  const broker = config.broker?.enabled
    ? new BrokerPoller(config.broker, (flows, logs) => {
        ingestFlows(flows);
        for (const l of logs) log[l.level === "warn" ? "warn" : "info"](l.kind, l.message);
      })
    : null;

  // --- Importer -------------------------------------------------------
  const importer = new Importer({
    limits: () => config.capacity,
    emitPackets: ingestPackets,
    emitFlows: ingestFlows,
    onEvent: (event) => {
      importsWriter.push({
        started_at: event.started_at,
        finished_at: event.finished_at ?? null,
        path: event.path,
        status: event.status,
        bytes_total: event.bytes_total,
        bytes_processed: event.bytes_processed,
        packets_imported: event.packets_imported,
        error: event.error ?? null,
      });
      log.info("importer", `${event.status}: ${event.path}`, { packets: event.packets_imported });
    },
  });

  // --- Uplink -----------------------------------------------------------
  let appliedRevision = 0;
  let currentInterfaces: ReportedInterface[] = [];
  const uplink =
    env.consoleUrl && env.token
      ? new ConsoleUplink(
          { consoleUrl: env.consoleUrl, token: env.token },
          {
            version: VERSION,
            getStats: () => ({
              uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
              flows_per_second: flowsPerSecondWindow,
              packets_per_second: packetsPerSecondCount,
              flows_total: flowsTotal,
              packets_total: packetsTotal,
              dropped_total: droppedTotal + rollup.droppedTotal(),
              local_bytes: 0,
              queue_depth: rollup.rawQueueDepth(),
              inputs: flowInputs.map((f) => ({ name: f.name, status: "running" })),
              capacity: governor.runtime(),
            }),
            getInterfaces: () => currentInterfaces,
            getAppliedRevision: () => appliedRevision,
            onConfig: (nextConfig, revision) => {
              config = normalizeConfig(nextConfig);
              saveConfig(config);
              governor.setLimits(config.capacity);
              appliedRevision = revision;
              log.info("uplink", `Applied config revision ${revision}`);
            },
          },
        )
      : null;

  // --- Local API ----------------------------------------------------
  const api = new LocalApiServer({
    version: VERSION,
    startedAt,
    getCapacity: () => governor.runtime(),
    getInterfaces: () => currentInterfaces,
    getStatus: () => ({
      flows_total: flowsTotal,
      packets_total: packetsTotal,
      dropped_total: droppedTotal + rollup.droppedTotal(),
      exporters: flowInputs.flatMap((f) => f.listExporters()),
      shed_stage: governor.shedStage(),
    }),
    triggerImport: () => importer.triggerScan(),
    history: {
      coverage: () => store.historyCoverage(),
      timeline: (minutes, limit) => store.historyTimeline(minutes, limit),
      talkers: (hours, limit) => store.historyTopTalkers(hours, limit),
      services: (hours, limit) => store.historyServiceMix(hours, limit),
      retentionRuns: (limit) => store.retentionRuns(limit),
      runRetention: () => store.runRetentionJob(config.capacity),
    },
  });

  async function refreshInterfaces(): Promise<void> {
    try {
      currentInterfaces = await listInterfaces();
      const metrics = await interfaceTracker.sample(currentInterfaces);
      for (const m of metrics) interfaceMetricsWriter.push(m as unknown as Record<string, unknown>);
      if (metrics.length) uplink?.queue({ interface_metrics: metrics });
    } catch (err) {
      log.warn("interfaces", "Failed to refresh interfaces", { error: err instanceof Error ? err.message : String(err) });
    }
  }
  await refreshInterfaces();
  const interfaceTimer = setInterval(() => void refreshInterfaces(), 10_000);
  interfaceTimer.unref?.();

  const supervisedInputs: Supervised[] = [
    ...flowInputs.map((f) => f.supervised),
    new Supervised("packets", () => packetCapture, packetCapture),
    new Supervised("icmp", () => icmp, icmp),
    new Supervised("snmp", () => snmp, snmp),
    new Supervised("wmi", () => wmi, wmi),
    new Supervised("devices", () => devices, devices),
    ...(broker ? [new Supervised("broker", () => broker, broker)] : []),
    new Supervised("importer", () => importer, importer),
  ];

  for (const s of supervisedInputs) s.start();
  uplink?.start(config.uplink.batch_seconds);
  api.start(env.apiPort ?? config.api.port, config.api.bind_address);

  log.info("startup", `AMDAI collector v${VERSION} running`, { timescale: migration.timescale });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutdown", `Received ${signal}, shutting down`);
    clearInterval(interfaceTimer);
    for (const s of supervisedInputs) s.stop();
    uplink?.stop();
    await api.stop();
    for (const w of [packetsWriter, flowsWriter, flowRollupsWriter, interfaceMetricsWriter, probeResultsWriter, deviceFactsWriter, importsWriter, capacityEventsWriter]) {
      await w.flush();
      w.close();
    }
    await store.end();
    log.info("shutdown", "Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("startup", "Fatal error during startup", { error: err instanceof Error ? err.stack ?? err.message : String(err) });
  process.exit(1);
});
