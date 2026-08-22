import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Cpu, Gauge, HardDrive, Loader2, RotateCcw, Save, Zap } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getApplianceOverview, updateCollectorCapacity } from "@/lib/collector.functions";
import { normalizeConfig, formatBitsPerSecond, formatBytes } from "@/lib/collector-types";
import type { CollectorRow } from "@/lib/collector-types";
import {
  CAPACITY_PROFILES,
  DISSECTION_DEPTH_LABELS,
  SHED_ORDER,
  SHED_STAGE_DETAIL,
  SHED_STAGE_LABELS,
  formatCount,
  formatLimitBytes,
  isCustomized,
  limitsForProfile,
  normalizeLimits,
  projectDailyBytes,
  projectRunwayHours,
  validateLimits,
  type CapacityLimits,
  type CapacityProfileId,
  type DissectionDepth,
} from "@/lib/capacity";
import {
  applyProfileToIngest,
  describeIngestLimits,
  getIngestLimits,
  seedIngestLimitsFromAppliance,
  setIngestLimits,
  type IngestLimits,
} from "@/lib/ingest-capacity";

export const Route = createFileRoute("/_authenticated/capacity")({
  component: CapacityPage,
  head: () => ({
    meta: [
      { title: "Capacity & scaling — NetTAP telemetry appliance" },
      {
        name: "description",
        content:
          "Size the NetTAP appliance: pick a capacity profile, tune capture, flow, retention and write-path ceilings, and see live headroom against the VM's CPU, memory and disk.",
      },
      { property: "og:title", content: "Capacity & scaling — NetTAP telemetry appliance" },
      {
        property: "og:description",
        content:
          "Configurable ingestion ceilings for packets, NetFlow/IPFIX, logs and imports, validated against the resources the appliance reports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

type NumericField = {
  key: keyof CapacityLimits;
  label: string;
  hint: string;
  unit?: string;
  /** Renders as a byte size instead of a raw count. */
  bytes?: boolean;
  zeroMeansUnlimited?: boolean;
};

const IMPORT_FIELDS: NumericField[] = [
  {
    key: "max_import_bytes",
    label: "Max import file size",
    hint: "0 = unlimited, bounded only by free disk. The appliance streams; it never loads a file into memory.",
    bytes: true,
    zeroMeansUnlimited: true,
  },
  {
    key: "max_packets_per_import",
    label: "Packets stored per import",
    hint: "Replaces the old fixed 20,000-packet ceiling. 0 = store every packet in the file.",
    unit: "packets",
    zeroMeansUnlimited: true,
  },
  {
    key: "upload_chunk_bytes",
    label: "Resumable upload chunk",
    hint: "Browser uploads are sliced to this size so a dropped connection resumes instead of restarting.",
    bytes: true,
  },
  {
    key: "import_concurrency",
    label: "Concurrent imports",
    hint: "How many files the appliance dissects at once. Each one costs roughly a core.",
    unit: "files",
  },
];

const CAPTURE_FIELDS: NumericField[] = [
  { key: "ring_file_mb", label: "Ring buffer file size", hint: "dumpcap rotates at this size.", unit: "MB" },
  {
    key: "ring_files",
    label: "Ring buffer files",
    hint: "File size x file count is the hard disk ceiling for live capture.",
    unit: "files",
  },
  {
    key: "snaplen_bytes",
    label: "Snap length",
    hint: "Bytes captured per frame. Lower it to trade payload for line rate; 0 captures the full frame.",
    bytes: true,
  },
  {
    key: "dissect_workers",
    label: "Dissection workers",
    hint: "Parallel tshark workers reading from the ring buffer.",
    unit: "workers",
  },
];

const FLOW_FIELDS: NumericField[] = [
  {
    key: "max_flows_per_second",
    label: "Flow ceiling",
    hint: "Sustained NetFlow/IPFIX/sFlow records per second before the appliance sheds fidelity.",
    unit: "flows/s",
  },
  {
    key: "max_packets_per_second",
    label: "Packet ceiling",
    hint: "Sustained packet rows stored per second before shedding.",
    unit: "packets/s",
  },
  {
    key: "receiver_workers",
    label: "Receiver workers",
    hint: "UDP sockets bound per flow port with SO_REUSEPORT, spreading load across cores.",
    unit: "workers",
  },
  {
    key: "socket_buffer_mb",
    label: "Socket receive buffer",
    hint: "SO_RCVBUF per receiver. Needs matching net.core.rmem_max, which the installer sets.",
    unit: "MB",
  },
];

const WRITE_FIELDS: NumericField[] = [
  { key: "copy_batch_rows", label: "COPY batch size", hint: "Rows per COPY into local Postgres.", unit: "rows" },
  { key: "flush_interval_ms", label: "Flush interval", hint: "Partial batches flush on this timer.", unit: "ms" },
  {
    key: "queue_high_water",
    label: "Queue high-water mark",
    hint: "Rows buffered in memory before overflow spills to the disk spool.",
    unit: "rows",
  },
  { key: "spool_max_gb", label: "Disk spool ceiling", hint: "Survives database stalls and uplink outages.", unit: "GB" },
  { key: "rollup_seconds", label: "Rollup interval", hint: "Conversation rollup bucket width.", unit: "s" },
];

const RETENTION_FIELDS: NumericField[] = [
  { key: "raw_packet_hours", label: "Raw packet window", hint: "Per-packet rows kept for deep drill-down.", unit: "hours" },
  { key: "flow_metadata_days", label: "Flow metadata window", hint: "Minute rollups kept at full dimensionality.", unit: "days" },
  { key: "summary_days", label: "Summary window", hint: "Hourly summaries for long-term trend questions.", unit: "days" },
  { key: "local_max_gb", label: "Database budget", hint: "Retention tightens automatically as this fills.", unit: "GB" },
  { key: "compress_after_hours", label: "Compress chunks after", hint: "Timescale compression, typically 8-15x on flow metadata.", unit: "hours" },
];

function CapacityPage() {
  const queryClient = useQueryClient();
  const loadOverview = useServerFn(getApplianceOverview);
  const saveCapacity = useServerFn(updateCollectorCapacity);

  const overview = useQuery({
    queryKey: ["appliance-overview"],
    queryFn: () => loadOverview(),
    refetchInterval: 20_000,
  });

  const collectors: CollectorRow[] = overview.data?.collectors ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = collectors.find((row) => row.id === selectedId) ?? collectors[0] ?? null;

  const applianceLimits = useMemo(
    () => (selected ? normalizeLimits(normalizeConfig(selected.config).capacity) : null),
    [selected],
  );

  const [draft, setDraft] = useState<CapacityLimits | null>(null);
  useEffect(() => {
    setDraft(applianceLimits ? { ...applianceLimits } : null);
  }, [applianceLimits, selected?.id]);

  const runtime = selected?.stats?.capacity ?? null;
  const host = runtime?.host ?? null;
  const issues = useMemo(() => (draft ? validateLimits(draft, host) : []), [draft, host]);
  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");
  const dirty = Boolean(draft && applianceLimits && JSON.stringify(draft) !== JSON.stringify(applianceLimits));

  const [ingest, setIngest] = useState<IngestLimits>(() => getIngestLimits());
  useEffect(() => {
    seedIngestLimitsFromAppliance(applianceLimits);
    setIngest(getIngestLimits());
  }, [applianceLimits]);

  const save = useMutation({
    mutationFn: async () => {
      if (!selected || !draft) throw new Error("Nothing to publish.");
      return saveCapacity({ data: { id: selected.id, limits: draft } });
    },
    onSuccess: (result) => {
      toast.success(
        `Capacity published as revision ${result.config_revision}. The appliance applies it on its next check-in.`,
      );
      for (const warning of result.warnings ?? []) toast.warning(warning.message);
      void queryClient.invalidateQueries({ queryKey: ["appliance-overview"] });
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  function patch(key: keyof CapacityLimits, value: number | string) {
    setDraft((current) => (current ? { ...current, [key]: value, profile: "custom" } : current));
  }

  function pickProfile(id: CapacityProfileId) {
    if (id === "custom") return;
    setDraft(limitsForProfile(id as Exclude<CapacityProfileId, "custom">));
  }

  const projection = draft ? projectDailyBytes(draft) : null;
  const runwayHours = draft ? projectRunwayHours(draft) : 0;
  const stage = runtime?.shed_stage ?? "full";

  return (
    <AppShell>
      <ScrollArea className="h-full">
        <div className="mx-auto max-w-6xl space-y-6 p-6">
          <header className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">Capacity &amp; scaling</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Every ingestion ceiling is configuration. Pick a profile that matches the VM, then tune
              individual limits — the console validates them against the CPU, memory and disk the
              appliance reports, so you can add resources and raise throughput without touching code.
            </p>
          </header>

          {overview.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading appliance capacity…
            </div>
          ) : null}

          {/* Browser ingest limits work with or without an appliance. */}
          <section className="border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Browser import limits</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Used when you drag a file into Datasets — decoding happens in this tab, so keep
                  very large captures on the appliance importer. Currently {describeIngestLimits(ingest)}.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {CAPACITY_PROFILES.map((profile) => (
                  <Button
                    key={profile.id}
                    type="button"
                    size="sm"
                    variant={ingest.profile === profile.id && !ingest.overridden ? "default" : "outline"}
                    onClick={() => setIngest(applyProfileToIngest(profile.id))}
                  >
                    {profile.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="browser-bytes" className="text-xs">
                  Max file size (MB, 0 = unlimited)
                </Label>
                <Input
                  id="browser-bytes"
                  type="number"
                  min={0}
                  value={Math.round(ingest.max_import_bytes / (1024 * 1024))}
                  onChange={(event) =>
                    setIngest(
                      setIngestLimits({
                        max_import_bytes: Math.max(0, Number(event.target.value)) * 1024 * 1024,
                        overridden: true,
                        profile: "custom",
                      }),
                    )
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="browser-packets" className="text-xs">
                  Packets decoded per file (0 = all)
                </Label>
                <Input
                  id="browser-packets"
                  type="number"
                  min={0}
                  value={ingest.max_packets_per_import}
                  onChange={(event) =>
                    setIngest(
                      setIngestLimits({
                        max_packets_per_import: Math.max(0, Number(event.target.value)),
                        overridden: true,
                        profile: "custom",
                      }),
                    )
                  }
                />
              </div>
            </div>
          </section>

          {!collectors.length ? (
            <section className="border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
              No appliance is paired yet. Register one on the Appliance page to get live capture, flow
              reception, streaming imports of any size, and the full capacity controls below.
            </section>
          ) : null}

          {selected && draft ? (
            <>
              <section className="border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">{selected.name}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selected.hostname ?? "hostname unknown"} · {selected.os} · config revision{" "}
                      {selected.config_revision} (applied {selected.applied_revision})
                    </p>
                  </div>
                  {collectors.length > 1 ? (
                    <div className="flex flex-wrap gap-2">
                      {collectors.map((row) => (
                        <Button
                          key={row.id}
                          type="button"
                          size="sm"
                          variant={row.id === selected.id ? "default" : "outline"}
                          onClick={() => setSelectedId(row.id)}
                        >
                          {row.name}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat
                    icon={<Cpu className="h-4 w-4" />}
                    label="Detected VM"
                    value={host ? `${host.vcpu} vCPU · ${host.ram_gb} GB` : "Awaiting check-in"}
                    detail={host ? `${host.disk_free_gb} GB free of ${host.disk_total_gb} GB` : "—"}
                  />
                  <Stat
                    icon={<Zap className="h-4 w-4" />}
                    label="Flow rate"
                    value={`${(runtime?.flows_per_second ?? selected.stats?.flows_per_second ?? 0).toLocaleString()} /s`}
                    detail={`ceiling ${draft.max_flows_per_second.toLocaleString()} /s`}
                  />
                  <Stat
                    icon={<Gauge className="h-4 w-4" />}
                    label="Queue depth"
                    value={(runtime?.queue_depth ?? selected.stats?.queue_depth ?? 0).toLocaleString()}
                    detail={`spill at ${draft.queue_high_water.toLocaleString()} · spool ${formatBytes(
                      runtime?.spool_bytes ?? 0,
                    )}`}
                  />
                  <Stat
                    icon={<HardDrive className="h-4 w-4" />}
                    label="Database"
                    value={formatBytes(runtime?.db_bytes ?? selected.stats?.local_bytes ?? 0)}
                    detail={`budget ${draft.local_max_gb} GB · runway ${
                      Number.isFinite(runwayHours) ? `${(runwayHours / 24).toFixed(1)} days` : "unbounded"
                    }`}
                  />
                </div>

                <div className="mt-4 border border-border bg-background p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Fidelity ladder
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {SHED_ORDER.map((entry) => (
                      <span
                        key={entry}
                        className={`px-2 py-1 text-xs ${
                          entry === stage
                            ? "bg-primary text-primary-foreground"
                            : "border border-border text-muted-foreground"
                        }`}
                      >
                        {SHED_STAGE_LABELS[entry]}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {SHED_STAGE_DETAIL[stage]}
                    {runtime?.shed_reason ? ` — ${runtime.shed_reason}` : ""}
                  </p>
                </div>
              </section>

              <section className="border border-border bg-card p-4">
                <h2 className="text-sm font-semibold">Sizing profile</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Profiles set every limit below at once. Editing any single field switches the
                  profile to “custom” and keeps your value.
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {CAPACITY_PROFILES.map((profile) => {
                    const active = draft.profile === profile.id && !isCustomized(draft);
                    const fits =
                      !host ||
                      (host.vcpu >= profile.requires.vcpu &&
                        host.ram_gb >= profile.requires.ram_gb * 0.9 &&
                        host.disk_total_gb >= profile.requires.disk_gb * 0.9);
                    return (
                      <button
                        key={profile.id}
                        type="button"
                        onClick={() => pickProfile(profile.id)}
                        className={`border p-3 text-left transition-colors ${
                          active ? "border-primary bg-accent" : "border-border hover:bg-accent/50"
                        }`}
                      >
                        <p className="text-sm font-semibold">{profile.label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{profile.blurb}</p>
                        <p className="mt-2 text-xs">
                          {profile.headline.flows_per_second.toLocaleString()} flows/s ·{" "}
                          {formatBitsPerSecond(profile.headline.capture_bps)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          needs {profile.requires.vcpu} vCPU · {profile.requires.ram_gb} GB ·{" "}
                          {profile.requires.disk_gb} GB
                        </p>
                        {!fits ? (
                          <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                            <AlertTriangle className="h-3 w-3" /> exceeds detected VM
                          </p>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>

              <FieldGroup title="File imports" fields={IMPORT_FIELDS} draft={draft} onChange={patch} issues={issues} />
              <FieldGroup title="Live capture" fields={CAPTURE_FIELDS} draft={draft} onChange={patch} issues={issues}>
                <div className="space-y-1">
                  <Label htmlFor="dissect-depth" className="text-xs">
                    Dissection depth
                  </Label>
                  <select
                    id="dissect-depth"
                    className="h-9 w-full border border-input bg-background px-2 text-sm"
                    value={draft.dissect_depth}
                    onChange={(event) => patch("dissect_depth", event.target.value as DissectionDepth)}
                  >
                    {(Object.keys(DISSECTION_DEPTH_LABELS) as DissectionDepth[]).map((depth) => (
                      <option key={depth} value={depth}>
                        {DISSECTION_DEPTH_LABELS[depth]}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Shallower decoding trades application detail for line rate under pressure.
                  </p>
                </div>
              </FieldGroup>
              <FieldGroup title="Flow receivers" fields={FLOW_FIELDS} draft={draft} onChange={patch} issues={issues} />
              <FieldGroup title="Write path" fields={WRITE_FIELDS} draft={draft} onChange={patch} issues={issues} />
              <FieldGroup title="Retention &amp; disk" fields={RETENTION_FIELDS} draft={draft} onChange={patch} issues={issues} />

              <section className="border border-border bg-card p-4">
                <h2 className="text-sm font-semibold">Projection at these ceilings</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Stat
                    label="Raw per day"
                    value={`${(projection ? projection.raw_per_day / 1e9 : 0).toFixed(0)} GB`}
                    detail="before compression"
                  />
                  <Stat
                    label="Stored per day"
                    value={`${(projection ? projection.compressed_per_day / 1e9 : 0).toFixed(0)} GB`}
                    detail={`compressed after ${draft.compress_after_hours}h`}
                  />
                  <Stat
                    label="Budget runway"
                    value={
                      Number.isFinite(runwayHours) ? `${(runwayHours / 24).toFixed(1)} days` : "unbounded"
                    }
                    detail={`${draft.local_max_gb} GB database budget`}
                  />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Sustained worst case: {draft.max_flows_per_second.toLocaleString()} flows/s and{" "}
                  {draft.max_packets_per_second.toLocaleString()} packets/s, at ~250 B per flow row and
                  ~400 B per packet row. Imports and bursts sit on top of this.
                </p>
              </section>

              {issues.length ? (
                <section className="space-y-2 border border-border bg-card p-4">
                  {errors.map((issue) => (
                    <p key={`${issue.field}-e`} className="flex items-start gap-2 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {issue.message}
                    </p>
                  ))}
                  {warnings.map((issue) => (
                    <p key={`${issue.field}-w`} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {issue.message}
                    </p>
                  ))}
                </section>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 pb-6">
                <Button
                  type="button"
                  onClick={() => save.mutate()}
                  disabled={!dirty || errors.length > 0 || save.isPending}
                >
                  {save.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Publish capacity
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDraft(applianceLimits ? { ...applianceLimits } : null)}
                  disabled={!dirty}
                >
                  <RotateCcw className="mr-2 h-4 w-4" /> Discard changes
                </Button>
                <p className="text-xs text-muted-foreground">
                  {dirty
                    ? "Unpublished changes. The appliance picks them up on its next check-in."
                    : "In sync with the running appliance configuration."}
                </p>
              </div>
            </>
          ) : null}
        </div>
      </ScrollArea>
    </AppShell>
  );
}

function Stat({
  icon,
  label,
  value,
  detail,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="border border-border bg-background p-3">
      <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function FieldGroup({
  title,
  fields,
  draft,
  onChange,
  issues,
  children,
}: {
  title: string;
  fields: NumericField[];
  draft: CapacityLimits;
  onChange: (key: keyof CapacityLimits, value: number) => void;
  issues: { field: string; level: string; message: string }[];
  children?: React.ReactNode;
}) {
  return (
    <section className="border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {fields.map((field) => {
          const raw = Number(draft[field.key]);
          const issue = issues.find((entry) => entry.field === field.key);
          return (
            <div key={String(field.key)} className="space-y-1">
              <Label htmlFor={`cap-${String(field.key)}`} className="text-xs">
                {field.label}
                {field.bytes ? " (MB)" : field.unit ? ` (${field.unit})` : ""}
              </Label>
              <Input
                id={`cap-${String(field.key)}`}
                type="number"
                min={0}
                value={field.bytes ? Math.round(raw / (1024 * 1024)) : raw}
                onChange={(event) => {
                  const next = Math.max(0, Number(event.target.value));
                  onChange(field.key, field.bytes ? next * 1024 * 1024 : next);
                }}
              />
              <p className="text-xs text-muted-foreground">
                {field.hint}
                {field.zeroMeansUnlimited
                  ? ` Now: ${field.bytes ? formatLimitBytes(raw) : formatCount(raw)}.`
                  : ""}
              </p>
              {issue ? (
                <p
                  className={`text-xs ${
                    issue.level === "error" ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {issue.message}
                </p>
              ) : null}
            </div>
          );
        })}
        {children}
      </div>
    </section>
  );
}
