import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Database, HardDrive, Pin, PinOff, RefreshCw, Timer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { describeVantage } from "@/lib/ingest-types";
import {
  formatBytes,
  TIER_LABELS,
  type RetentionSettings,
  type RetentionTier,
} from "@/lib/retention-types";
import {
  getRetentionOverview,
  purgeDatasetDetail,
  runRetentionNow,
  saveRetentionSettings,
  setDatasetPinned,
} from "@/lib/retention.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Retention admin — telemetry storage & 7-day windows" },
      {
        name: "description",
        content:
          "Administrative view of telemetry storage: rows and bytes per table, the 7-day metadata retention timeline, per-dataset tiers, pinning, and cleanup run history.",
      },
      { property: "og:title", content: "Retention admin — telemetry storage & 7-day windows" },
      {
        property: "og:description",
        content:
          "See how much telemetry metadata is stored, what the next rolling purge removes, and pin the datasets that must keep raw packet detail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RetentionAdminPage,
});

const TIER_COLORS: Record<RetentionTier, string> = {
  raw: "hsl(var(--primary))",
  metadata: "hsl(var(--chart-2, var(--primary)))",
  summary: "hsl(var(--muted-foreground))",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-lg text-foreground">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function RetentionAdminPage() {
  const queryClient = useQueryClient();
  const fetchOverview = useServerFn(getRetentionOverview);
  const saveSettings = useServerFn(saveRetentionSettings);
  const runNow = useServerFn(runRetentionNow);
  const pinDataset = useServerFn(setDatasetPinned);
  const purgeRaw = useServerFn(purgeDatasetDetail);

  const { data, isLoading } = useQuery({
    queryKey: ["retention-overview"],
    queryFn: () => fetchOverview(),
    refetchInterval: 60_000,
  });

  const [form, setForm] = useState<RetentionSettings | null>(null);
  useEffect(() => {
    if (data?.settings && !form) setForm(data.settings);
  }, [data?.settings, form]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["retention-overview"] });

  const saveMutation = useMutation({
    mutationFn: (settings: RetentionSettings) => saveSettings({ data: settings }),
    onSuccess: () => {
      toast.success("Retention windows saved");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const runMutation = useMutation({
    mutationFn: () => runNow(),
    onSuccess: (result) => {
      toast.success(
        `Retention run complete — ${result.rows_rolled.toLocaleString()} rolled up, ${result.rows_deleted.toLocaleString()} rows removed`,
      );
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const pinMutation = useMutation({
    mutationFn: (input: { id: string; pinned: boolean }) => pinDataset({ data: input }),
    onSuccess: (_r, input) => {
      toast.success(input.pinned ? "Dataset pinned — never purged" : "Dataset unpinned");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const purgeMutation = useMutation({
    mutationFn: (id: string) => purgeRaw({ data: { id } }),
    onSuccess: () => {
      toast.success("Raw packet detail dropped for this dataset");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const timeline = useMemo(() => {
    const byDay = new Map<string, { day: string; raw: number; metadata: number; summary: number }>();
    for (const row of data?.timeline ?? []) {
      const day = row.day.slice(5);
      const entry = byDay.get(day) ?? { day, raw: 0, metadata: 0, summary: 0 };
      if (row.tier === "raw") entry.raw = row.rows_count;
      if (row.tier === "metadata") entry.metadata = row.rows_count;
      if (row.tier === "summary") entry.summary = row.rows_count;
      byDay.set(day, entry);
    }
    return [...byDay.values()];
  }, [data?.timeline]);

  const usedPct = data ? Math.min((data.totals.bytes / data.totals.budget_bytes) * 100, 100) : 0;

  return (
    <AppShell>
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h1 className="font-mono text-sm font-semibold tracking-tight text-foreground">
              Retention admin
            </h1>
            <p className="text-xs text-muted-foreground">
              Raw packets roll into 1-minute metadata, metadata overwrites after the retention
              window, hourly summaries survive longest.
            </p>
          </div>
          <Button size="sm" onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${runMutation.isPending ? "animate-spin" : ""}`} />
            Run retention now
          </Button>
        </header>

        <ScrollArea className="flex-1">
          <div className="space-y-5 p-5">
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Database used"
                value={formatBytes(data?.totals.bytes ?? 0)}
                hint={`${usedPct.toFixed(1)}% of ${formatBytes(data?.totals.budget_bytes ?? 0)} budget`}
              />
              <Stat label="Total rows" value={(data?.totals.rows ?? 0).toLocaleString()} />
              <Stat
                label="Raw window"
                value={`${data?.settings.raw_hours ?? 24} h`}
                hint="per-packet detail"
              />
              <Stat
                label="Metadata window"
                value={`${data?.settings.metadata_days ?? 7} d`}
                hint="then overwritten"
              />
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <Timer className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Retention windows</h2>
              </div>
              {form ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Raw packet hours</Label>
                    <Input
                      type="number"
                      min={1}
                      value={form.raw_hours}
                      onChange={(e) => setForm({ ...form, raw_hours: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Metadata days</Label>
                    <Input
                      type="number"
                      min={1}
                      value={form.metadata_days}
                      onChange={(e) => setForm({ ...form, metadata_days: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Summary days</Label>
                    <Input
                      type="number"
                      min={1}
                      value={form.summary_days}
                      onChange={(e) => setForm({ ...form, summary_days: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Search chunk cap / dataset</Label>
                    <Input
                      type="number"
                      min={100}
                      value={form.chunk_cap}
                      onChange={(e) => setForm({ ...form, chunk_cap: Number(e.target.value) })}
                    />
                  </div>
                  <div className="flex items-end gap-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={form.enabled}
                        onCheckedChange={(enabled) => setForm({ ...form, enabled })}
                      />
                      <span className="text-xs text-muted-foreground">Auto purge</span>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => saveMutation.mutate(form)}
                      disabled={saveMutation.isPending}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Loading settings…</p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Cleanup runs automatically every hour. Pinned datasets are exempt from every purge.
              </p>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">
                  Rows per day by fidelity (last 14 days)
                </h2>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={timeline}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="raw" name={TIER_LABELS.raw} fill={TIER_COLORS.raw} stackId="a" />
                    <Bar
                      dataKey="metadata"
                      name={TIER_LABELS.metadata}
                      fill={TIER_COLORS.metadata}
                      stackId="a"
                    />
                    <Bar
                      dataKey="summary"
                      name={TIER_LABELS.summary}
                      fill={TIER_COLORS.summary}
                      stackId="a"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <Database className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Datasets</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-4 py-2 text-left font-medium">Dataset</th>
                      <th className="px-3 py-2 text-left font-medium">Vantage</th>
                      <th className="px-3 py-2 text-left font-medium">Tier</th>
                      <th className="px-3 py-2 text-right font-medium">Packets</th>
                      <th className="px-3 py-2 text-right font-medium">Rollups</th>
                      <th className="px-3 py-2 text-right font-medium">Summaries</th>
                      <th className="px-3 py-2 text-right font-medium">Chunks</th>
                      <th className="px-3 py-2 text-right font-medium">Est. size</th>
                      <th className="px-3 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.datasets ?? []).map((row) => (
                      <tr key={row.id} className="border-b border-border/60">
                        <td className="px-4 py-2">
                          <span className="font-medium text-foreground">{row.name}</span>
                          <span className="ml-2 text-muted-foreground">{row.kind}</span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {describeVantage(row.vantage).label}
                          {row.observation_point ? ` · ${row.observation_point}` : ""}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={row.pinned ? "default" : "secondary"}>
                            {row.pinned
                              ? "pinned"
                              : TIER_LABELS[(row.retention_tier as RetentionTier) ?? "raw"]}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {row.packet_rows.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {row.rollup_rows.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {row.summary_rows.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {row.chunk_rows.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatBytes(row.estimated_bytes)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                pinMutation.mutate({ id: row.id, pinned: !row.pinned })
                              }
                            >
                              {row.pinned ? (
                                <PinOff className="h-3.5 w-3.5" />
                              ) : (
                                <Pin className="h-3.5 w-3.5" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => purgeMutation.mutate(row.id)}
                              disabled={row.packet_rows === 0}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!isLoading && (data?.datasets ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">
                          No datasets ingested yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-foreground">Storage by table</h2>
                <div className="space-y-1.5">
                  {(data?.storage ?? []).slice(0, 12).map((row) => (
                    <div key={row.table_name} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-muted-foreground">{row.table_name}</span>
                      <span className="font-mono text-foreground">
                        {row.live_rows.toLocaleString()} rows · {formatBytes(row.total_bytes)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-foreground">Cleanup history</h2>
                <div className="space-y-1.5">
                  {(data?.runs ?? []).map((run) => (
                    <div key={run.id} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {new Date(run.started_at).toLocaleString()}
                      </span>
                      <span className="font-mono text-foreground">
                        {run.rows_rolled.toLocaleString()} rolled · {run.rows_deleted.toLocaleString()}{" "}
                        deleted · {run.duration_ms ?? 0} ms
                      </span>
                    </div>
                  ))}
                  {(data?.runs ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No runs recorded yet.</p>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        </ScrollArea>
      </div>
    </AppShell>
  );
}
