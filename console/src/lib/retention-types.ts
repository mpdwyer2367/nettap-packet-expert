/** Client-safe types and constants for long-term metadata retention. */

export type RetentionSettings = {
  raw_hours: number;
  metadata_days: number;
  summary_days: number;
  chunk_cap: number;
  enabled: boolean;
};

export const DEFAULT_RETENTION: RetentionSettings = {
  raw_hours: 24,
  metadata_days: 7,
  summary_days: 90,
  chunk_cap: 2000,
  enabled: true,
};

export type RetentionTier = "raw" | "metadata" | "summary";

export const TIER_LABELS: Record<RetentionTier, string> = {
  raw: "Raw packets",
  metadata: "Metadata rollups",
  summary: "Hourly summaries",
};

export const TIER_FIDELITY: Record<RetentionTier, string> = {
  raw: "Per-packet detail is present: frame numbers, TCP flags, dissected fields and decode state.",
  metadata:
    "Per-packet rows have expired. Remaining fidelity is 1-minute conversation rollups (5-tuple, protocol/service, packets, bytes, risk tags) — packet-exact answers are not possible for this period.",
  summary:
    "Only hourly summaries remain (totals, top talkers, top services, protocol mix, risk counts). Answer at trend level only.",
};

export type RetentionDatasetRow = {
  id: string;
  name: string;
  kind: string;
  vantage: string;
  observation_point: string | null;
  retention_tier: string;
  pinned: boolean;
  created_at: string;
  range_start: string | null;
  range_end: string | null;
  packet_rows: number;
  rollup_rows: number;
  summary_rows: number;
  chunk_rows: number;
  estimated_bytes: number;
};

export type StorageRow = { table_name: string; live_rows: number; total_bytes: number };

export type TimelineRow = { day: string; tier: string; rows_count: number };

export type RetentionRun = {
  id: number;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  rows_rolled: number;
  rows_deleted: number;
  chunks_deleted: number;
  summaries_written: number;
  status: string;
  error: string | null;
};

export type RetentionOverview = {
  settings: RetentionSettings;
  datasets: RetentionDatasetRow[];
  storage: StorageRow[];
  timeline: TimelineRow[];
  runs: RetentionRun[];
  totals: { bytes: number; rows: number; budget_bytes: number };
};

/** Rough per-row cost measured from live tables (bytes, index included). */
export const ROW_BYTES = { packet: 245, rollup: 200, summary: 320, chunk: 19_000 } as const;

export function estimateBytes(row: {
  packet_rows: number;
  rollup_rows: number;
  summary_rows: number;
  chunk_rows: number;
}) {
  return (
    row.packet_rows * ROW_BYTES.packet +
    row.rollup_rows * ROW_BYTES.rollup +
    row.summary_rows * ROW_BYTES.summary +
    row.chunk_rows * ROW_BYTES.chunk
  );
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
