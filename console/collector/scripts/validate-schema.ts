/**
 * Validates the local Postgres history schema end to end:
 *   1. migrates the store (tables, indexes, partitions, sql/schema.sql)
 *   2. writes raw packets/flows across old and recent timestamps
 *   3. runs the rollup job and asserts raw flows collapse into flow_rollups
 *   4. runs the retention cleanup and asserts each tier is trimmed
 *   5. asserts the history views the LLM queries return the surviving rows
 *
 * Usage: AMDAI_LOCAL_PG=postgres://... npx tsx scripts/validate-schema.ts
 */
import { PgStore } from "../src/store/pg.js";
import { loadEnv } from "../src/config.js";
import { limitsForProfile } from "../src/capacity.js";

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail = ""): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

async function main(): Promise<void> {
  const env = loadEnv();
  const store = new PgStore(env.localPg);
  const limits = { ...limitsForProfile("small"), raw_packet_hours: 2, flow_metadata_days: 7, summary_days: 30 };

  const status = await store.migrate(limits);
  check("migrate() applies schema", true, `timescale=${status.timescale}`);

  const pool = store.getPool();

  // Reset only the tables this validation touches.
  for (const t of ["packets", "flows", "flow_rollups", "interface_metrics", "logs", "retention_runs"]) {
    await pool.query(`delete from ${t}`);
  }

  // Ensure partitions exist for the historical timestamps we are about to write.
  if (!status.timescale) {
    for (const days of [0, 1, 2, 9, 40]) {
      const d = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const next = new Date(new Date(`${d}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
      for (const t of ["packets", "flows", "flow_rollups", "interface_metrics", "logs"]) {
        await pool.query(
          `create table if not exists ${t}_p${d.replace(/-/g, "")} partition of ${t} for values from ('${d}') to ('${next}')`,
        ).catch(() => {});
      }
    }
  }

  // ---- seed raw + metadata rows -----------------------------------------
  await pool.query(
    `insert into packets (ts, interface_name, src_ip, dst_ip, src_port, dst_port, protocol, length, info, vantage, observation_point)
     values ($1,'eth0','10.0.0.5','10.0.0.9',44321,443,'TCP',1400,'TLS app data','tap','core'),
            ($2,'eth0','10.0.0.5','10.0.0.9',44322,443,'TCP',1400,'TLS app data','tap','core')`,
    [hoursAgo(0.1), hoursAgo(9)],
  );
  await pool.query(
    `insert into flows (ts, exporter_ip, protocol, src_ip, dst_ip, src_port, dst_port, packets, bytes, tcp_flags, sampling_rate, app_protocol, service, risk_tags, vantage, observation_point, source)
     values ($1,'10.0.0.1','TCP','10.0.0.5','10.0.0.9',44321,443,10,9000,24,1,'tls','https','{}','tap','core','ipfix'),
            ($2,'10.0.0.1','TCP','10.0.0.5','10.0.0.9',44321,443,5,4000,24,1,'tls','https','{beaconing}','tap','core','ipfix'),
            ($2,'10.0.0.1','TCP','10.0.0.5','10.0.0.9',44321,443,7,6000,24,1,'tls','https','{}','tap','core','ipfix'),
            ($3,'10.0.0.1','UDP','10.0.0.5','8.8.8.8',5353,53,3,300,0,1,'dns','dns','{}','tap','core','netflow')`,
    [hoursAgo(0.1), hoursAgo(9), daysAgo(9)],
  );
  await pool.query(
    `insert into interface_metrics (bucket_ts, interface_name, rx_bytes, tx_bytes, rx_packets, tx_packets, errors, discards, utilization_pct, source)
     values ($1,'eth0',1000,900,10,9,0,0,1.5,'local'), ($2,'eth0',2000,1800,20,18,0,0,2.5,'local')`,
    [hoursAgo(0.1), daysAgo(40)],
  );

  // ---- rollup job --------------------------------------------------------
  const rolled = await store.runRollupJob(2);
  const rollups = await pool.query(
    `select src_ip::text, dst_ip::text, protocol, packets, bytes, flow_count, risk_tags from flow_rollups order by bucket_ts`,
  );
  check("rollup writes flow_rollups", rolled > 0 && rollups.rowCount! >= 2, `rolled=${rolled} buckets=${rollups.rowCount}`);
  const tcpBucket = rollups.rows.find((r) => r.protocol === "TCP");
  check(
    "rollup aggregates packets/bytes per minute bucket",
    Number(tcpBucket?.packets) === 12 && Number(tcpBucket?.bytes) === 10000 && Number(tcpBucket?.flow_count) === 2,
    `packets=${tcpBucket?.packets} bytes=${tcpBucket?.bytes} flows=${tcpBucket?.flow_count}`,
  );
  check("rollup preserves risk tags", (tcpBucket?.risk_tags ?? []).includes("beaconing"), JSON.stringify(tcpBucket?.risk_tags));

  const remainingFlows = await pool.query(`select count(*)::int as n from flows`);
  check("rollup drains rolled raw flows", remainingFlows.rows[0].n === 1, `raw flows left=${remainingFlows.rows[0].n}`);

  const rolledAgain = await store.runRollupJob(2);
  check("rollup is idempotent", rolledAgain === 0, `second pass rolled=${rolledAgain}`);

  // ---- retention cleanup -------------------------------------------------
  const result = await store.runRetentionJob(limits);
  check("retention cleanup runs", result.rowsDeleted >= 0, JSON.stringify(result));

  const packetsLeft = await pool.query(`select count(*)::int as n, min(ts) as oldest from packets`);
  check(
    "raw packets trimmed to raw window",
    packetsLeft.rows[0].n === 1 && new Date(packetsLeft.rows[0].oldest).getTime() > Date.now() - 2 * 3_600_000,
    `packets=${packetsLeft.rows[0].n} oldest=${packetsLeft.rows[0].oldest}`,
  );
  const rollupsLeft = await pool.query(
    `select count(*)::int as n, min(bucket_ts) as oldest from flow_rollups`,
  );
  check(
    "flow metadata trimmed to metadata window",
    rollupsLeft.rows[0].n >= 1 && new Date(rollupsLeft.rows[0].oldest).getTime() > Date.now() - 7 * 86_400_000,
    `rollups=${rollupsLeft.rows[0].n} oldest=${rollupsLeft.rows[0].oldest}`,
  );
  const ifLeft = await pool.query(`select count(*)::int as n from interface_metrics`);
  check("interface metrics trimmed to summary window", ifLeft.rows[0].n === 1, `rows=${ifLeft.rows[0].n}`);

  const run = await pool.query(
    `select status, rows_rolled, rows_deleted, partitions_dropped, duration_ms, detail from retention_runs order by started_at desc limit 1`,
  );
  check(
    "retention run is logged",
    run.rows[0]?.status === "ok" && run.rows[0]?.duration_ms !== null,
    JSON.stringify(run.rows[0]),
  );

  // ---- history surfaces the LLM queries ---------------------------------
  const timeline = await pool.query(`select tier, service, packets, bytes from history_flow_timeline order by bucket_ts`);
  check("history_flow_timeline returns rows", timeline.rowCount! > 0, `rows=${timeline.rowCount}`);
  check(
    "history timeline labels fidelity tiers",
    timeline.rows.some((r) => r.tier === "metadata"),
    timeline.rows.map((r) => r.tier).join(","),
  );
  const talkers = await pool.query(`select src_ip::text, dst_ip::text, bytes from history_top_talkers order by bytes desc`);
  check("history_top_talkers returns rows", talkers.rowCount! > 0, JSON.stringify(talkers.rows[0] ?? {}));
  const services = await pool.query(`select service, bytes from history_service_mix order by bytes desc`);
  check("history_service_mix returns rows", services.rowCount! > 0, JSON.stringify(services.rows[0] ?? {}));
  const coverage = await store.historyCoverage();
  check("history_coverage reports every source", coverage.length >= 4, coverage.map((c) => `${c.source}:${c.rows_count}`).join(" "));

  // ---- partition maintenance -------------------------------------------
  if (!status.timescale) {
    const made = await store.ensureUpcomingPartitions(3);
    check("partition maintenance creates future partitions", made >= 0, `created=${made}`);
    const future = await pool.query(
      `select count(*)::int as n from pg_class where relname like 'flows_p%'`,
    );
    check("future flow partitions exist", future.rows[0].n >= 3, `partitions=${future.rows[0].n}`);
  }

  await store.end();

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error("validation crashed:", err);
  process.exit(1);
});
