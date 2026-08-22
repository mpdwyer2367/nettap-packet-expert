/**
 * Safe SQL surface for model-authored history questions.
 *
 * The model may only read the four `history_*` views, which are already
 * scoped to the signed-in user in the database. This module owns the
 * client-side half of the guard (shape + allow-list validation) and the
 * summarization of result sets so the model gets a compact, groundable
 * answer instead of thousands of raw rows. The database function
 * `history_query` re-validates everything independently — this validator
 * exists to fail fast with a useful message the model can correct.
 */

export const HISTORY_VIEWS = [
  "history_flow_timeline",
  "history_top_talkers",
  "history_service_mix",
  "history_coverage",
] as const;

export const HISTORY_SCHEMA_DOC = `Read-only views (already filtered to the current user; join freely, aggregate as needed):

history_flow_timeline(dataset_id uuid, bucket_ts timestamptz, tier text, packets bigint, bytes bigint, flows bigint)
  One row per time bucket per fidelity tier. tier='raw' is per-minute from full packet rows,
  tier='metadata' is per-minute conversation rollups, tier='summary' is hourly summaries.

history_top_talkers(dataset_id uuid, tier text, src_ip text, dst_ip text, bytes bigint, packets bigint, flows bigint, first_seen timestamptz, last_seen timestamptz)
  Conversation totals per IP pair across the raw and metadata tiers.

history_service_mix(dataset_id uuid, tier text, service text, app_protocol text, protocol text, dst_port int, bytes bigint, packets bigint, flows bigint, first_seen timestamptz, last_seen timestamptz)
  Traffic totals per service/application protocol.

history_coverage(source text, tier text, dataset_id uuid, rows_count bigint, oldest timestamptz, newest timestamptz)
  What history still exists per telemetry source, with its oldest and newest timestamp.
  Query this first when a question reaches back in time, so you never claim data that has been aged out.

Rules for the SQL you write:
- exactly one read-only statement, starting with SELECT or WITH, no trailing semicolon needed
- FROM/JOIN only the four views above; no base tables, no pg_catalog/information_schema
- always aggregate or ORDER BY + LIMIT; results are capped at max_rows
- timestamps are timestamptz; use now() - interval '24 hours' style windows
- IP columns are text; cast with ::text when comparing`;

const BANNED_KEYWORDS = [
  "insert", "update", "delete", "drop", "alter", "create", "truncate", "grant", "revoke",
  "comment", "copy", "call", "do", "merge", "vacuum", "analyze", "reindex", "cluster",
  "listen", "notify", "lock", "set", "reset", "begin", "commit", "rollback", "savepoint",
  "prepare", "execute", "explain", "refresh", "import", "security", "definer",
  "pg_sleep", "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "dblink",
  "lo_import", "lo_export",
];

export type HistorySqlValidation =
  | { ok: true; sql: string }
  | { ok: false; error: string };

/** Remove string literals and comments so guards can't be tripped or hidden by them. */
function scrub(sql: string): string {
  return sql
    .replace(/'([^']|'')*'/g, " 'lit' ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

export function validateHistorySql(raw: string): HistorySqlValidation {
  const sql = (raw ?? "").trim().replace(/;\s*$/, "");
  if (!sql) return { ok: false, error: "Empty query." };
  if (sql.length > 4000) return { ok: false, error: "Query too long (max 4000 characters)." };

  const stripped = scrub(sql);
  const lowered = stripped.toLowerCase();

  if (stripped.includes(";")) {
    return { ok: false, error: "Only a single statement is allowed; remove the extra ';'." };
  }
  if (!/^\s*(select|with)\s/.test(lowered)) {
    return { ok: false, error: "Only SELECT/WITH queries are allowed." };
  }

  for (const kw of BANNED_KEYWORDS) {
    if (new RegExp(`(^|[^a-z0-9_])${kw}([^a-z0-9_]|$)`).test(lowered)) {
      return { ok: false, error: `Disallowed keyword in query: ${kw}.` };
    }
  }

  // Catch both `from view` / `join view` and comma-separated FROM lists
  // (`from history_top_talkers, user_roles`), which the naive pattern misses.
  const refs: string[] = [];
  for (const m of lowered.matchAll(/(?:from|join)\s+((?:[a-z_][a-z0-9_$."]*\s*,\s*)*[a-z_][a-z0-9_$."]*)/g)) {
    for (const piece of (m[1] ?? "").split(",")) {
      const ref = piece.trim().replace(/"/g, "").replace(/^public\./, "");
      if (ref) refs.push(ref);
    }
  }
  for (const ref of refs) {
    if (!(HISTORY_VIEWS as readonly string[]).includes(ref)) {
      return {
        ok: false,
        error: `Only the history views may be read (got "${ref}"). Allowed: ${HISTORY_VIEWS.join(", ")}.`,
      };
    }
  }

  if (refs.length === 0) {
    return { ok: false, error: "Query must read at least one history view via FROM." };
  }

  return { ok: true, sql };
}

export type HistoryRow = Record<string, unknown>;

export interface HistorySqlSummary {
  row_count: number;
  truncated: boolean;
  columns: string[];
  numeric_totals: Record<string, number>;
  time_range: { column: string; start: string; end: string } | null;
  tiers: string[];
  narrative: string;
}

const isTimeColumn = (name: string) => /(_ts|_at|_seen|^ts$|^day$|^oldest$|^newest$)/.test(name);

/** Compact, groundable summary of a result set: totals, window, fidelity tiers. */
export function summarizeHistoryRows(rows: HistoryRow[], maxRows: number): HistorySqlSummary {
  const columns = rows.length > 0 ? Object.keys(rows[0] as HistoryRow) : [];

  const numeric_totals: Record<string, number> = {};
  for (const col of columns) {
    let total = 0;
    let seen = 0;
    for (const row of rows) {
      const raw = row[col];
      const num = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
      // bigint columns arrive as strings over PostgREST; only treat fully numeric values as numbers.
      if (Number.isFinite(num) && raw !== null && raw !== "" && !isTimeColumn(col)) {
        total += num;
        seen += 1;
      }
    }
    if (seen > 0 && seen === rows.length) numeric_totals[col] = Math.round(total * 1000) / 1000;
  }

  let time_range: HistorySqlSummary["time_range"] = null;
  const timeCol = columns.find(isTimeColumn);
  if (timeCol) {
    const stamps = rows
      .map((r) => (typeof r[timeCol] === "string" ? Date.parse(r[timeCol] as string) : NaN))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (stamps.length > 0) {
      time_range = {
        column: timeCol,
        start: new Date(stamps[0] as number).toISOString(),
        end: new Date(stamps[stamps.length - 1] as number).toISOString(),
      };
    }
  }

  const tiers = [
    ...new Set(
      rows
        .map((r) => r["tier"])
        .filter((t): t is string => typeof t === "string" && t.length > 0),
    ),
  ].sort();

  const truncated = rows.length >= maxRows;
  const parts: string[] = [
    `${rows.length} row${rows.length === 1 ? "" : "s"}${truncated ? ` (capped at ${maxRows}; narrow the window or add aggregation)` : ""}`,
  ];
  if (columns.length > 0) parts.push(`columns: ${columns.join(", ")}`);
  const totalsText = Object.entries(numeric_totals)
    .map(([k, v]) => `${k}=${v.toLocaleString("en-US")}`)
    .join(", ");
  if (totalsText) parts.push(`totals: ${totalsText}`);
  if (time_range) parts.push(`window: ${time_range.start} → ${time_range.end}`);
  if (tiers.length > 0) {
    parts.push(
      `fidelity tiers present: ${tiers.join(", ")}${tiers.includes("raw") ? "" : " (per-packet detail has aged out of this window)"}`,
    );
  }

  return {
    row_count: rows.length,
    truncated,
    columns,
    numeric_totals,
    time_range,
    tiers,
    narrative: parts.join("; ") + ".",
  };
}
