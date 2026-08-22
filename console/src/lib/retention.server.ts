import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  DEFAULT_RETENTION,
  estimateBytes,
  type RetentionDatasetRow,
  type RetentionOverview,
  type RetentionSettings,
} from "./retention-types";

type Client = SupabaseClient<Database>;

/** Cloud DB disk budget used for the "usage vs budget" gauge in the admin view. */
const BUDGET_BYTES = 8 * 1024 * 1024 * 1024;

async function countFor(
  supabase: Client,
  table: "packet_records" | "flow_rollups" | "retention_summaries" | "telemetry_chunks",
  datasetId: string,
) {
  const { count } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("dataset_id", datasetId);
  return count ?? 0;
}

export async function loadRetentionOverview(
  supabase: Client,
  userId: string,
): Promise<RetentionOverview> {
  const [settingsRes, datasetsRes, storageRes, timelineRes, runsRes] = await Promise.all([
    supabase
      .from("retention_settings")
      .select("raw_hours, metadata_days, summary_days, chunk_cap, enabled")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("datasets")
      .select(
        "id, name, kind, vantage, observation_point, retention_tier, pinned, created_at, range_start, range_end",
      )
      .order("created_at", { ascending: false }),
    supabase.rpc("retention_storage_stats"),
    supabase.rpc("retention_timeline", { p_days: 14 }),
    supabase
      .from("retention_runs")
      .select(
        "id, started_at, finished_at, duration_ms, rows_rolled, rows_deleted, chunks_deleted, summaries_written, status, error",
      )
      .order("started_at", { ascending: false })
      .limit(20),
  ]);

  const settings: RetentionSettings = settingsRes.data
    ? {
        raw_hours: settingsRes.data.raw_hours,
        metadata_days: settingsRes.data.metadata_days,
        summary_days: settingsRes.data.summary_days,
        chunk_cap: settingsRes.data.chunk_cap,
        enabled: settingsRes.data.enabled,
      }
    : { ...DEFAULT_RETENTION };

  const datasets: RetentionDatasetRow[] = await Promise.all(
    (datasetsRes.data ?? []).map(async (d) => {
      const [packet_rows, rollup_rows, summary_rows, chunk_rows] = await Promise.all([
        countFor(supabase, "packet_records", d.id),
        countFor(supabase, "flow_rollups", d.id),
        countFor(supabase, "retention_summaries", d.id),
        countFor(supabase, "telemetry_chunks", d.id),
      ]);
      return {
        id: d.id,
        name: d.name,
        kind: d.kind,
        vantage: d.vantage,
        observation_point: d.observation_point,
        retention_tier: d.retention_tier,
        pinned: d.pinned,
        created_at: d.created_at,
        range_start: d.range_start,
        range_end: d.range_end,
        packet_rows,
        rollup_rows,
        summary_rows,
        chunk_rows,
        estimated_bytes: estimateBytes({ packet_rows, rollup_rows, summary_rows, chunk_rows }),
      };
    }),
  );

  const storage = ((storageRes.data ?? []) as { table_name: string; live_rows: number; total_bytes: number }[]).map(
    (row) => ({
      table_name: row.table_name,
      live_rows: Number(row.live_rows ?? 0),
      total_bytes: Number(row.total_bytes ?? 0),
    }),
  );

  const timeline = ((timelineRes.data ?? []) as { day: string; tier: string; rows_count: number }[]).map((row) => ({
    day: String(row.day),
    tier: row.tier,
    rows_count: Number(row.rows_count ?? 0),
  }));

  return {
    settings,
    datasets,
    storage,
    timeline,
    runs: (runsRes.data ?? []).map((r) => ({
      id: r.id,
      started_at: r.started_at,
      finished_at: r.finished_at,
      duration_ms: r.duration_ms,
      rows_rolled: Number(r.rows_rolled ?? 0),
      rows_deleted: Number(r.rows_deleted ?? 0),
      chunks_deleted: Number(r.chunks_deleted ?? 0),
      summaries_written: Number(r.summaries_written ?? 0),
      status: r.status,
      error: r.error,
    })),
    totals: {
      bytes: storage.reduce((sum, row) => sum + row.total_bytes, 0),
      rows: storage.reduce((sum, row) => sum + row.live_rows, 0),
      budget_bytes: BUDGET_BYTES,
    },
  };
}

/** Drops raw packet detail for one dataset immediately (rollups/summaries stay). */
export async function purgeDatasetRaw(supabase: Client, datasetId: string) {
  const { error } = await supabase.from("packet_records").delete().eq("dataset_id", datasetId);
  if (error) throw new Error(error.message);
  const { error: tierError } = await supabase
    .from("datasets")
    .update({ retention_tier: "metadata" })
    .eq("id", datasetId);
  if (tierError) throw new Error(tierError.message);
  return { ok: true };
}

/** Retention posture for one dataset, phrased for the analyst model. */
export async function describeRetention(supabase: Client, datasetId: string) {
  const { data: dataset } = await supabase
    .from("datasets")
    .select("user_id, retention_tier, pinned, range_start, range_end")
    .eq("id", datasetId)
    .maybeSingle();
  const { data: settings } = dataset
    ? await supabase
        .from("retention_settings")
        .select("raw_hours, metadata_days, summary_days, enabled")
        .eq("user_id", dataset.user_id)
        .maybeSingle()
    : { data: null };

  const raw_hours = settings?.raw_hours ?? DEFAULT_RETENTION.raw_hours;
  const metadata_days = settings?.metadata_days ?? DEFAULT_RETENTION.metadata_days;
  const summary_days = settings?.summary_days ?? DEFAULT_RETENTION.summary_days;

  const [packetCount, rollupCount, summaryCount] = await Promise.all([
    countFor(supabase, "packet_records", datasetId),
    countFor(supabase, "flow_rollups", datasetId),
    countFor(supabase, "retention_summaries", datasetId),
  ]);

  return {
    windows: {
      raw_packets_hours: raw_hours,
      metadata_days,
      summary_days,
      enabled: settings?.enabled ?? DEFAULT_RETENTION.enabled,
    },
    dataset: {
      tier: dataset?.retention_tier ?? "raw",
      pinned: dataset?.pinned ?? false,
      range: { start: dataset?.range_start ?? null, end: dataset?.range_end ?? null },
    },
    available_fidelity: {
      raw_packet_rows: packetCount,
      minute_rollup_rows: rollupCount,
      hourly_summary_rows: summaryCount,
    },
    caveats: [
      `Per-packet detail is only kept for the most recent ${raw_hours}h unless the dataset is pinned.`,
      `Conversation metadata (1-minute rollups: 5-tuple, protocol/service, packets, bytes, risk tags) is kept for ${metadata_days} days, then overwritten.`,
      `Hourly summaries (totals, top talkers, top services, protocol mix, risk counts) are kept for ${summary_days} days.`,
      "For any period served by rollups or summaries, state that packet-exact detail has expired instead of implying it was absent from the network.",
    ],
  };
}
