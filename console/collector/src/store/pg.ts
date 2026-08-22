/**
 * Local Postgres/TimescaleDB store. Uses `pg` for connection management and
 * hand-rolled COPY streams for high-throughput writes (no extra deps).
 */
import { Client, Pool } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readdirSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { log } from "../logger.js";
import type { CapacityLimits } from "../capacity.js";
import { SPOOL_DIR, COLLECTOR_ROOT } from "../config.js";

export type ColumnDef = { name: string; type: string };

export const TABLES: Record<string, ColumnDef[]> = {
  packets: [
    { name: "ts", type: "timestamptz" },
    { name: "interface_name", type: "text" },
    { name: "src_ip", type: "inet" },
    { name: "dst_ip", type: "inet" },
    { name: "src_port", type: "int" },
    { name: "dst_port", type: "int" },
    { name: "protocol", type: "text" },
    { name: "length", type: "int" },
    { name: "info", type: "text" },
    { name: "vantage", type: "text" },
    { name: "observation_point", type: "text" },
  ],
  flows: [
    { name: "ts", type: "timestamptz" },
    { name: "exporter_ip", type: "inet" },
    { name: "protocol", type: "text" },
    { name: "src_ip", type: "inet" },
    { name: "dst_ip", type: "inet" },
    { name: "src_port", type: "int" },
    { name: "dst_port", type: "int" },
    { name: "packets", type: "bigint" },
    { name: "bytes", type: "bigint" },
    { name: "tcp_flags", type: "int" },
    { name: "sampling_rate", type: "int" },
    { name: "app_protocol", type: "text" },
    { name: "service", type: "text" },
    { name: "risk_tags", type: "text[]" },
    { name: "vantage", type: "text" },
    { name: "observation_point", type: "text" },
    { name: "source", type: "text" },
  ],
  flow_rollups: [
    { name: "bucket_ts", type: "timestamptz" },
    { name: "src_ip", type: "inet" },
    { name: "dst_ip", type: "inet" },
    { name: "src_port", type: "int" },
    { name: "dst_port", type: "int" },
    { name: "protocol", type: "text" },
    { name: "app_protocol", type: "text" },
    { name: "service", type: "text" },
    { name: "packets", type: "bigint" },
    { name: "bytes", type: "bigint" },
    { name: "flow_count", type: "bigint" },
    { name: "risk_tags", type: "text[]" },
    { name: "vantage", type: "text" },
  ],
  interface_metrics: [
    { name: "bucket_ts", type: "timestamptz" },
    { name: "interface_name", type: "text" },
    { name: "rx_bytes", type: "bigint" },
    { name: "tx_bytes", type: "bigint" },
    { name: "rx_packets", type: "bigint" },
    { name: "tx_packets", type: "bigint" },
    { name: "errors", type: "bigint" },
    { name: "discards", type: "bigint" },
    { name: "utilization_pct", type: "double precision" },
    { name: "source", type: "text" },
  ],
  logs: [
    { name: "ts", type: "timestamptz" },
    { name: "level", type: "text" },
    { name: "kind", type: "text" },
    { name: "message", type: "text" },
    { name: "extra", type: "jsonb" },
  ],
  snmp_samples: [
    { name: "ts", type: "timestamptz" },
    { name: "target", type: "text" },
    { name: "oid", type: "text" },
    { name: "metric", type: "text" },
    { name: "value", type: "double precision" },
    { name: "value_text", type: "text" },
    { name: "unit", type: "text" },
  ],
  wmi_samples: [
    { name: "ts", type: "timestamptz" },
    { name: "target", type: "text" },
    { name: "query_name", type: "text" },
    { name: "value_text", type: "text" },
    { name: "extra", type: "jsonb" },
  ],
  probe_results: [
    { name: "ts", type: "timestamptz" },
    { name: "kind", type: "text" },
    { name: "target", type: "text" },
    { name: "metric", type: "text" },
    { name: "value", type: "double precision" },
    { name: "value_text", type: "text" },
    { name: "unit", type: "text" },
    { name: "status", type: "text" },
    { name: "extra", type: "jsonb" },
  ],
  device_facts: [
    { name: "collected_at", type: "timestamptz" },
    { name: "host", type: "text" },
    { name: "source", type: "text" },
    { name: "kind", type: "text" },
    { name: "summary", type: "text" },
    { name: "content", type: "text" },
    { name: "extra", type: "jsonb" },
  ],
  imports: [
    { name: "started_at", type: "timestamptz" },
    { name: "finished_at", type: "timestamptz" },
    { name: "path", type: "text" },
    { name: "status", type: "text" },
    { name: "bytes_total", type: "bigint" },
    { name: "bytes_processed", type: "bigint" },
    { name: "packets_imported", type: "bigint" },
    { name: "error", type: "text" },
  ],
  capacity_events: [
    { name: "ts", type: "timestamptz" },
    { name: "from_stage", type: "text" },
    { name: "to_stage", type: "text" },
    { name: "reason", type: "text" },
  ],
};

const TIME_COLUMN: Record<string, string> = {
  packets: "ts",
  flows: "ts",
  flow_rollups: "bucket_ts",
  interface_metrics: "bucket_ts",
  logs: "ts",
  snmp_samples: "ts",
  wmi_samples: "ts",
  probe_results: "ts",
  device_facts: "collected_at",
  imports: "started_at",
  capacity_events: "ts",
};

function ddlColumns(table: string): string {
  return TABLES[table].map((c) => `"${c.name}" ${c.type}`).join(", ");
}

/** Escapes a single field for Postgres COPY text format. */
function escapeCopyField(value: unknown): string {
  if (value === null || value === undefined) return "\\N";
  let s: string;
  if (Array.isArray(value)) {
    // text[] -> Postgres array literal embedded in COPY text format.
    const inner = value
      .map((v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
      .join(",");
    s = `{${inner}}`;
  } else if (typeof value === "object") {
    s = JSON.stringify(value);
  } else {
    s = String(value);
  }
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

function buildCopyText(table: string, rows: Record<string, unknown>[]): string {
  const cols = TABLES[table].map((c) => c.name);
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(cols.map((c) => escapeCopyField(row[c])).join("\t"));
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

export type StoreStatus = {
  timescale: boolean;
  migratedAt: string;
};

export type RetentionResult = {
  rowsRolled: number;
  rowsDeleted: number;
  partitionsDropped: number;
};

export type HistoryCoverageRow = {
  source: string;
  tier: string;
  first_ts: string | null;
  last_ts: string | null;
  rows_count: string | number;
};

export class PgStore {
  private pool: Pool;
  private timescale = false;
  private lastFlushAt = Date.now();
  private lastLagMs = 0;

  constructor(private connectionString: string) {
    this.pool = new Pool({ connectionString, max: 8 });
  }

  async migrate(limits: CapacityLimits): Promise<StoreStatus> {
    const client = await this.pool.connect();
    try {
      const ext = await client.query(
        "select extname from pg_extension where extname = 'timescaledb'",
      );
      if (ext.rowCount === 0) {
        try {
          await client.query("create extension if not exists timescaledb");
          this.timescale = true;
        } catch {
          this.timescale = false;
        }
      } else {
        this.timescale = true;
      }
      log.info("store", this.timescale ? "TimescaleDB extension available" : "TimescaleDB not available, using native partitioning", {});

      for (const table of Object.keys(TABLES)) {
        await this.createTable(client, table);
      }

      if (this.timescale) {
        await this.applyTimescalePolicies(client, limits);
      } else {
        await this.ensureNativePartitions(client);
      }

      await this.applyHistorySchema(client);

      return { timescale: this.timescale, migratedAt: new Date().toISOString() };
    } finally {
      client.release();
    }
  }

  /**
   * Applies sql/schema.sql: retention bookkeeping, the history views the LLM
   * queries, and the rollup/cleanup/partition-maintenance functions.
   */
  private async applyHistorySchema(client: Client): Promise<void> {
    const path = join(COLLECTOR_ROOT, "sql", "schema.sql");
    try {
      const sql = readFileSync(path, "utf8");
      await client.query(sql);
      log.info("store", "History schema applied", { path });
    } catch (err) {
      log.error("store", "Failed to apply history schema", { error: String(err), path });
      throw err;
    }
  }

  /** Rolls closed raw flow minutes into flow_rollups. Returns rows written. */
  async runRollupJob(rawHours: number): Promise<number> {
    try {
      const r = await this.pool.query("select amdai_rollup_flows($1) as rolled", [rawHours]);
      return Number(r.rows[0]?.rolled ?? 0);
    } catch (err) {
      log.warn("store", "rollup job failed", { error: String(err) });
      return 0;
    }
  }

  /** Enforces the tiered retention window and logs the run to retention_runs. */
  async runRetentionJob(limits: CapacityLimits): Promise<RetentionResult> {
    try {
      const r = await this.pool.query(
        "select * from amdai_retention_cleanup($1, $2, $3)",
        [limits.raw_packet_hours, limits.flow_metadata_days, limits.summary_days],
      );
      const row = r.rows[0] ?? {};
      const result: RetentionResult = {
        rowsRolled: Number(row.rows_rolled ?? 0),
        rowsDeleted: Number(row.rows_deleted ?? 0),
        partitionsDropped: Number(row.partitions_dropped ?? 0),
      };
      log.info("store", "Retention cleanup complete", result);
      return result;
    } catch (err) {
      log.warn("store", "retention cleanup failed", { error: String(err) });
      return { rowsRolled: 0, rowsDeleted: 0, partitionsDropped: 0 };
    }
  }

  /** Pre-creates upcoming daily partitions so writes never hit a missing range. */
  async ensureUpcomingPartitions(daysAhead = 2): Promise<number> {
    if (this.timescale) return 0;
    try {
      const r = await this.pool.query("select amdai_ensure_partitions($1) as made", [daysAhead]);
      return Number(r.rows[0]?.made ?? 0);
    } catch (err) {
      log.warn("store", "partition maintenance failed", { error: String(err) });
      return 0;
    }
  }

  /** What history exists per tier — used to answer time-range questions honestly. */
  async historyCoverage(): Promise<HistoryCoverageRow[]> {
    try {
      const r = await this.pool.query("select * from history_coverage");
      return r.rows as HistoryCoverageRow[];
    } catch (err) {
      log.warn("store", "history coverage query failed", { error: String(err) });
      return [];
    }
  }

  /** Minute-level flow timeline across the raw and metadata tiers. */
  async historyTimeline(minutes: number, limit = 500): Promise<Record<string, unknown>[]> {
    return this.safeQuery(
      `select bucket_ts, tier, protocol, service, packets, bytes, flow_count
         from history_flow_timeline
        where bucket_ts >= now() - make_interval(mins => $1)
        order by bucket_ts desc
        limit $2`,
      [Math.max(1, minutes), Math.max(1, Math.min(limit, 5_000))],
    );
  }

  /** Top conversations by bytes over the requested window. */
  async historyTopTalkers(hours: number, limit = 25): Promise<Record<string, unknown>[]> {
    return this.safeQuery(
      `select hour_ts, host(src_ip) as src_ip, host(dst_ip) as dst_ip, packets, bytes, flow_count
         from history_top_talkers
        where hour_ts >= now() - make_interval(hours => $1)
        order by bytes desc
        limit $2`,
      [Math.max(1, hours), Math.max(1, Math.min(limit, 500))],
    );
  }

  /** Service/application mix by bytes over the requested window. */
  async historyServiceMix(hours: number, limit = 25): Promise<Record<string, unknown>[]> {
    return this.safeQuery(
      `select hour_ts, service, packets, bytes
         from history_service_mix
        where hour_ts >= now() - make_interval(hours => $1)
        order by bytes desc
        limit $2`,
      [Math.max(1, hours), Math.max(1, Math.min(limit, 500))],
    );
  }

  /** Recent retention/cleanup job runs. */
  async retentionRuns(limit = 20): Promise<Record<string, unknown>[]> {
    return this.safeQuery(
      `select id, started_at, finished_at, duration_ms, rows_rolled, rows_deleted,
              partitions_dropped, status, detail, error
         from retention_runs order by started_at desc limit $1`,
      [Math.max(1, Math.min(limit, 200))],
    );
  }

  private async safeQuery(sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
    try {
      const r = await this.pool.query(sql, params);
      return r.rows as Record<string, unknown>[];
    } catch (err) {
      log.warn("store", "history query failed", { error: String(err) });
      return [];
    }
  }


  private async createTable(client: Client, table: string): Promise<void> {
    const timeCol = TIME_COLUMN[table];
    if (this.timescale) {
      await client.query(`create table if not exists ${table} (${ddlColumns(table)})`);
      try {
        await client.query(
          `select create_hypertable('${table}', '${timeCol}', if_not_exists => true, migrate_data => true)`,
        );
      } catch (err) {
        log.warn("store", `create_hypertable failed for ${table}, continuing without it`, { error: String(err) });
      }
    } else {
      await client.query(
        `create table if not exists ${table} (${ddlColumns(table)}) partition by range (${timeCol})`,
      );
      await this.ensureDailyPartition(client, table, new Date());
      await this.ensureDailyPartition(client, table, new Date(Date.now() + 86_400_000));
    }

    if (table === "packets") {
      await client.query(
        `create index if not exists idx_packets_ts_brin on packets using brin (ts)`,
      ).catch(() => {});
      await client.query(
        `create index if not exists idx_packets_5tuple on packets (src_ip, dst_ip, ts)`,
      ).catch(() => {});
      await client.query(
        `create index if not exists idx_packets_dport_ts on packets (dst_port, ts)`,
      ).catch(() => {});
    }
    if (table === "flows") {
      await client.query(
        `create index if not exists idx_flows_ts_brin on flows using brin (ts)`,
      ).catch(() => {});
      await client.query(
        `create index if not exists idx_flows_5tuple on flows (src_ip, dst_ip, ts)`,
      ).catch(() => {});
      await client.query(
        `create index if not exists idx_flows_dport_ts on flows (dst_port, ts)`,
      ).catch(() => {});
    }
    if (table === "flow_rollups") {
      await client.query(
        `create index if not exists idx_rollups_ts_brin on flow_rollups using brin (bucket_ts)`,
      ).catch(() => {});
      await client.query(
        `create index if not exists idx_rollups_5tuple on flow_rollups (src_ip, dst_ip, bucket_ts)`,
      ).catch(() => {});
    }
  }

  private async ensureDailyPartition(client: Client, table: string, forDate: Date): Promise<void> {
    const day = new Date(Date.UTC(forDate.getUTCFullYear(), forDate.getUTCMonth(), forDate.getUTCDate()));
    const next = new Date(day.getTime() + 86_400_000);
    const suffix = day.toISOString().slice(0, 10).replace(/-/g, "");
    const name = `${table}_p${suffix}`;
    await client.query(
      `create table if not exists ${name} partition of ${table} for values from ('${day.toISOString()}') to ('${next.toISOString()}')`,
    ).catch((err) => log.warn("store", `partition create failed for ${name}`, { error: String(err) }));
  }

  private async ensureNativePartitions(client: Client): Promise<void> {
    for (const table of Object.keys(TABLES)) {
      await this.ensureDailyPartition(client, table, new Date());
      await this.ensureDailyPartition(client, table, new Date(Date.now() + 86_400_000));
    }
  }

  private async applyTimescalePolicies(client: Client, limits: CapacityLimits): Promise<void> {
    const policies: [string, string][] = [
      ["packets", `${limits.raw_packet_hours} hours`],
      ["flows", `${limits.flow_metadata_days} days`],
      ["flow_rollups", `${limits.summary_days} days`],
      ["interface_metrics", `${limits.summary_days} days`],
    ];
    for (const [table, interval] of policies) {
      try {
        await client.query(`select add_retention_policy('${table}', interval '${interval}', if_not_exists => true)`);
      } catch (err) {
        log.warn("store", `retention policy failed for ${table}`, { error: String(err) });
      }
    }
    try {
      await client.query(`alter table packets set (timescaledb.compress, timescaledb.compress_segmentby = 'interface_name')`);
      await client.query(`select add_compression_policy('packets', interval '${limits.compress_after_hours} hours', if_not_exists => true)`);
    } catch (err) {
      log.warn("store", "compression policy failed for packets", { error: String(err) });
    }
    try {
      await client.query(`alter table flows set (timescaledb.compress, timescaledb.compress_segmentby = 'exporter_ip')`);
      await client.query(`select add_compression_policy('flows', interval '${limits.compress_after_hours} hours', if_not_exists => true)`);
    } catch (err) {
      log.warn("store", "compression policy failed for flows", { error: String(err) });
    }
    try {
      await client.query(`
        create materialized view if not exists flow_rollups_hourly
        with (timescaledb.continuous) as
        select time_bucket('1 hour', bucket_ts) as hour_ts,
               src_ip, dst_ip, protocol, service,
               sum(packets) as packets, sum(bytes) as bytes, sum(flow_count) as flow_count
        from flow_rollups
        group by hour_ts, src_ip, dst_ip, protocol, service
        with no data
      `);
      await client.query(`
        select add_continuous_aggregate_policy('flow_rollups_hourly',
          start_offset => interval '3 hours', end_offset => interval '1 hour', schedule_interval => interval '1 hour',
          if_not_exists => true)
      `);
    } catch (err) {
      log.warn("store", "continuous aggregate setup failed", { error: String(err) });
    }
  }


  async dbSizeBytes(): Promise<number> {
    try {
      const r = await this.pool.query("select pg_database_size(current_database()) as size");
      return Number(r.rows[0]?.size ?? 0);
    } catch {
      return 0;
    }
  }

  writeLagMs(): number {
    return this.lastLagMs;
  }

  newBatchWriter(table: string, opts: { batchRows: number; flushIntervalMs: number; spoolMaxGb: number }, onBackpressure?: (depth: number) => void): BatchWriter {
    return new BatchWriter(this, table, opts, onBackpressure);
  }

  async end(): Promise<void> {
    await this.pool.end();
  }

  getPool(): Pool {
    return this.pool;
  }
}

/**
 * Buffers rows for a table and flushes them via a manually built COPY text
 * stream over the `pg` driver's native `copyFrom`-less API. Since we cannot
 * add a COPY streaming dependency, we use `pg`'s query() with a text COPY
 * FROM STDIN executed against a dedicated client using the low-level
 * `Client#query` + stream interface it exposes via `pg-protocol` is not
 * public, so we drive it with a manual multi-statement INSERT batch instead,
 * keeping the same buffering/backpressure/spool semantics as a COPY writer.
 */
export class BatchWriter {
  private buffer: Record<string, unknown>[] = [];
  private timer: NodeJS.Timeout;
  private spoolDir: string;
  private flushing = false;

  constructor(
    private store: PgStore,
    private table: string,
    private opts: { batchRows: number; flushIntervalMs: number; spoolMaxGb: number },
    private onBackpressure?: (depth: number) => void,
  ) {
    this.spoolDir = join(SPOOL_DIR, table);
    mkdirSync(this.spoolDir, { recursive: true });
    this.timer = setInterval(() => void this.flush(), opts.flushIntervalMs);
    this.timer.unref?.();
  }

  push(row: Record<string, unknown>): void {
    this.buffer.push(row);
    this.onBackpressure?.(this.buffer.length);
    if (this.buffer.length >= this.opts.batchRows) void this.flush();
  }

  depth(): number {
    return this.buffer.length;
  }

  async flush(): Promise<void> {
    if (this.flushing || !this.buffer.length) return;
    this.flushing = true;
    const rows = this.buffer.splice(0, this.buffer.length);
    try {
      await this.copyViaText(rows);
    } catch (err) {
      log.warn("store", `flush failed for ${this.table}, spooling to disk`, { error: String(err) });
      this.spool(rows);
    } finally {
      this.flushing = false;
    }
  }

  private async copyViaText(rows: Record<string, unknown>[]): Promise<void> {
    const client = await this.store.getPool().connect();
    try {
      const cols = TABLES[this.table].map((c) => `"${c.name}"`).join(",");
      const copyText = buildCopyText(this.table, rows);
      try {
        await copyFromText(client as unknown as Client, `copy ${this.table} (${cols}) from stdin`, copyText);
      } catch (err) {
        log.warn("store", `COPY failed for ${this.table}, falling back to parameterized INSERT`, { error: String(err) });
        await insertRowsFallback(client as unknown as Client, this.table, rows);
      }
    } finally {
      client.release();
    }
  }

  private spool(rows: Record<string, unknown>[]): void {
    const segment = join(this.spoolDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`);
    const text = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    try {
      const capBytes = this.opts.spoolMaxGb * 1e9;
      let used = 0;
      for (const f of readdirSync(this.spoolDir)) used += statSync(join(this.spoolDir, f)).size;
      if (used + text.length > capBytes) {
        const files = readdirSync(this.spoolDir).sort();
        while (files.length && used + text.length > capBytes) {
          const oldest = files.shift();
          if (!oldest) break;
          const full = join(this.spoolDir, oldest);
          used -= statSync(full).size;
          unlinkSync(full);
        }
      }
      writeFileSync(segment, text);
    } catch (err) {
      log.error("store", "spool write failed, dropping rows", { error: String(err), table: this.table });
    }
  }

  spoolBytes(): number {
    try {
      return readdirSync(this.spoolDir).reduce((sum, f) => sum + statSync(join(this.spoolDir, f)).size, 0);
    } catch {
      return 0;
    }
  }

  /** Replays spooled segments on startup, in order, oldest first. */
  async replaySpool(): Promise<void> {
    let files: string[] = [];
    try {
      files = readdirSync(this.spoolDir).sort();
    } catch {
      return;
    }
    for (const f of files) {
      const full = join(this.spoolDir, f);
      try {
        const lines = readFileSync(full, "utf8").split("\n").filter(Boolean);
        const rows = lines.map((l) => JSON.parse(l));
        await this.copyViaText(rows);
        unlinkSync(full);
      } catch (err) {
        log.warn("store", `failed to replay spool segment ${f}, leaving in place`, { error: String(err) });
        break;
      }
    }
  }

  close(): void {
    clearInterval(this.timer);
  }
}

/**
 * Streams rows into Postgres via COPY FROM STDIN using pg-copy-streams,
 * which drives the real COPY wire protocol against the pool's connection
 * instead of hand-rolling it. Falls back to a parameterized multi-row
 * INSERT when COPY itself fails (e.g. permissions, non-Postgres proxy),
 * so correctness holds even without COPY support.
 */
async function copyFromText(client: Client, sql: string, text: string): Promise<void> {
  const stream = client.query(copyFrom(sql));
  const source = Readable.from([text]);
  await pipeline(source, stream);
}

/** Parameterized multi-row INSERT fallback for when COPY is unavailable. */
async function insertRowsFallback(client: Client, table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  const cols = TABLES[table].map((c) => c.name);
  const values: unknown[] = [];
  const tuples: string[] = [];
  let p = 1;
  for (const row of rows) {
    const placeholders = cols.map((c) => {
      const v = row[c];
      values.push(v === undefined ? null : v);
      return `$${p++}`;
    });
    tuples.push(`(${placeholders.join(",")})`);
  }
  const colList = cols.map((c) => `"${c}"`).join(",");
  await client.query(`insert into ${table} (${colList}) values ${tuples.join(",")}`, values);
}

export { buildCopyText, escapeCopyField, insertRowsFallback };
