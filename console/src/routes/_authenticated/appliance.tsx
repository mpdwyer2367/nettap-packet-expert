import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Copy,
  KeyRound,
  Network,
  Plus,
  RefreshCw,
  Router as RouterIcon,
  Server,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CAPTURE_VANTAGES } from "@/lib/ingest-types";
import {
  COLLECTOR_OS_LABELS,
  COLLECTOR_STATUS_LABELS,
  formatBitsPerSecond,
  formatBytes,
  type CollectorConfig,
  type CollectorOs,
  type CollectorRow,
} from "@/lib/collector-types";
import {
  getApplianceOverview,
  getInterfaceMetrics,
  registerCollector,
  removeCollector,
  rotateCollectorTokenFn,
  updateCollectorConfig,
} from "@/lib/collector.functions";

export const Route = createFileRoute("/_authenticated/appliance")({
  head: () => ({
    meta: [
      { title: "Appliance & LAN monitoring — interfaces, NetFlow, IPFIX" },
      {
        name: "description",
        content:
          "Pair the NetTAP collector appliance, pick a LAN interface, watch live utilization, and configure NetFlow/IPFIX receivers plus ICMP, SNMP and WMI monitoring.",
      },
      { property: "og:title", content: "Appliance & LAN monitoring — interfaces, NetFlow, IPFIX" },
      {
        property: "og:description",
        content:
          "Deployable collector for VMware or VirtualBox: interface utilization graphs, flow receivers, and device polling feeding the telemetry analyst chat.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AppliancePage,
});

const STATUS_TONE: Record<string, string> = {
  online: "border-primary/40 bg-primary/10 text-primary",
  pending: "border-border bg-muted text-muted-foreground",
  stale: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  disabled: "border-border bg-muted text-muted-foreground",
};

function AppliancePage() {
  const queryClient = useQueryClient();
  const fetchOverview = useServerFn(getApplianceOverview);
  const fetchMetrics = useServerFn(getInterfaceMetrics);
  const register = useServerFn(registerCollector);
  const rotate = useServerFn(rotateCollectorTokenFn);
  const saveConfig = useServerFn(updateCollectorConfig);
  const drop = useServerFn(removeCollector);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedInterface, setSelectedInterface] = useState<string | null>(null);
  const [window, setWindow] = useState(15);
  const [newName, setNewName] = useState("");
  const [newOs, setNewOs] = useState<CollectorOs>("linux");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [draft, setDraft] = useState<CollectorConfig | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["appliance-overview"],
    queryFn: () => fetchOverview(),
    refetchInterval: 15_000,
  });

  const collectors = data?.collectors ?? [];
  const active: CollectorRow | null =
    collectors.find((row) => row.id === selectedId) ?? collectors[0] ?? null;

  useEffect(() => {
    if (active && active.id !== selectedId) setSelectedId(active.id);
  }, [active, selectedId]);

  useEffect(() => {
    setDraft(active ? active.config : null);
  }, [active]);

  const interfaces = useMemo(
    () => (data?.interfaces ?? []).filter((row) => !active || row.collector_id === active.id),
    [data?.interfaces, active],
  );

  useEffect(() => {
    if (!interfaces.length) return;
    if (selectedInterface && interfaces.some((row) => row.name === selectedInterface)) return;
    const preferred =
      interfaces.find((row) => row.capture_enabled) ??
      interfaces.find((row) => row.is_up && !row.is_loopback) ??
      interfaces[0];
    setSelectedInterface(preferred?.name ?? null);
  }, [interfaces, selectedInterface]);

  const { data: metrics } = useQuery({
    queryKey: ["interface-metrics", active?.id, selectedInterface, window],
    queryFn: () =>
      fetchMetrics({
        data: { collectorId: active!.id, interfaceName: selectedInterface!, minutes: window },
      }),
    enabled: Boolean(active?.id && selectedInterface),
    refetchInterval: 10_000,
  });

  const chart = useMemo(
    () =>
      (metrics ?? []).map((point) => ({
        time: new Date(point.bucket_ts).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        rx: Math.round(point.rx_bps),
        tx: Math.round(point.tx_bps),
        utilization: point.utilization_pct,
      })),
    [metrics],
  );

  const peak = chart.reduce((max, point) => Math.max(max, point.rx, point.tx), 0);
  const latest = chart[chart.length - 1];

  const registerMutation = useMutation({
    mutationFn: () => register({ data: { name: newName.trim(), os: newOs } }),
    onSuccess: async (result) => {
      setIssuedToken(result.token);
      setNewName("");
      setSelectedId(result.collector.id);
      await queryClient.invalidateQueries({ queryKey: ["appliance-overview"] });
      toast.success("Appliance registered — copy the pairing token now, it is shown once.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rotateMutation = useMutation({
    mutationFn: (id: string) => rotate({ data: { id } }),
    onSuccess: async (result) => {
      setIssuedToken(result.token);
      await queryClient.invalidateQueries({ queryKey: ["appliance-overview"] });
      toast.success("New token issued — update the appliance to reconnect it.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveMutation = useMutation({
    mutationFn: (config: CollectorConfig) => saveConfig({ data: { id: active!.id, config } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["appliance-overview"] });
      toast.success("Configuration published — the appliance applies it on its next check-in.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => drop({ data: { id } }),
    onSuccess: async () => {
      setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: ["appliance-overview"] });
      toast.success("Appliance removed.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function copy(value: string, label: string) {
    void navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  }

  function toggleCapture(name: string, enabled: boolean) {
    if (!draft) return;
    const iface = interfaces.find((row) => row.name === name);
    const existing = draft.captures.find((capture) => capture.interface_name === name);
    const captures = existing
      ? draft.captures.map((capture) =>
          capture.interface_name === name ? { ...capture, enabled } : capture,
        )
      : [
          ...draft.captures,
          {
            interface_name: name,
            enabled,
            filter: "",
            slice_seconds: 10,
            promiscuous: true,
            vantage: "host_agent",
            observation_point: iface?.description ?? name,
            push_packets: true,
          },
        ];
    setDraft({ ...draft, captures });
  }

  function updateReceiver(index: number, patch: Partial<CollectorConfig["flow_receivers"][number]>) {
    if (!draft) return;
    setDraft({
      ...draft,
      flow_receivers: draft.flow_receivers.map((receiver, i) =>
        i === index ? { ...receiver, ...patch } : receiver,
      ),
    });
  }

  const dirty = draft && active ? JSON.stringify(draft) !== JSON.stringify(active.config) : false;
  const origin = typeof globalThis.location === "undefined" ? "" : globalThis.location.origin;

  return (
    <AppShell>
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Server className="h-4 w-4 text-primary" />
            Appliance &amp; LAN monitoring
          </h1>
          <p className="text-xs text-muted-foreground">
            Pair the collector that runs on your VM, choose interfaces to watch, and configure flow
            receivers and device polling.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["appliance-overview"] })}
        >
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          Refresh
        </Button>
      </header>

      <ScrollArea className="flex-1">
        <div className="space-y-5 p-6">
          {/* Appliances */}
          <section className="rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Server className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Appliances</h2>
            </div>
            <div className="space-y-3 p-4">
              {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
              {!isLoading && collectors.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No appliance paired yet. Register one below, then install the collector on your
                  Linux, Windows or macOS virtual machine.
                </p>
              )}

              {collectors.map((collector) => {
                const isActive = collector.id === active?.id;
                return (
                  <button
                    key={collector.id}
                    type="button"
                    onClick={() => setSelectedId(collector.id)}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left transition-colors ${
                      isActive ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {collector.name}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {COLLECTOR_OS_LABELS[collector.os]}
                        </span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {collector.hostname ?? "waiting for check-in"}
                        {collector.version ? ` · v${collector.version}` : ""}
                        {collector.last_seen_at
                          ? ` · last seen ${new Date(collector.last_seen_at).toLocaleTimeString()}`
                          : ""}
                        {collector.stats.flows_per_second
                          ? ` · ${collector.stats.flows_per_second.toFixed(0)} flows/s`
                          : ""}
                        {typeof collector.stats.local_bytes === "number"
                          ? ` · ${formatBytes(collector.stats.local_bytes)} local`
                          : ""}
                      </p>
                      {collector.last_error && (
                        <p className="truncate text-xs text-destructive">{collector.last_error}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline" className={STATUS_TONE[collector.status]}>
                        {COLLECTOR_STATUS_LABELS[collector.status]}
                      </Badge>
                      {collector.applied_revision < collector.config_revision && (
                        <Badge variant="outline" className="border-amber-500/40 text-amber-500">
                          config pending
                        </Badge>
                      )}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Rotate token for ${collector.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          rotateMutation.mutate(collector.id);
                        }}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove ${collector.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteMutation.mutate(collector.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </button>
                );
              })}

              <div className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-border p-3">
                <div className="grow space-y-1">
                  <Label htmlFor="collector-name" className="text-xs">
                    Appliance name
                  </Label>
                  <Input
                    id="collector-name"
                    value={newName}
                    placeholder="lab-vm-collector"
                    onChange={(event) => setNewName(event.target.value)}
                  />
                </div>
                <div className="w-52 space-y-1">
                  <Label className="text-xs">Operating system</Label>
                  <Select value={newOs} onValueChange={(value) => setNewOs(value as CollectorOs)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(COLLECTOR_OS_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => registerMutation.mutate()}
                  disabled={!newName.trim() || registerMutation.isPending}
                >
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Register appliance
                </Button>
              </div>

              {issuedToken && (
                <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
                  <p className="text-xs font-medium text-foreground">
                    Pairing token — shown once. Set it on the appliance as
                    <code className="mx-1">NetTAP_COLLECTOR_TOKEN</code>.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 font-mono text-xs">
                      {issuedToken}
                    </code>
                    <Button size="sm" variant="outline" onClick={() => copy(issuedToken, "Token")}>
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      Copy
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 font-mono text-xs">
                      {`NetTAP_CONSOLE_URL=${origin} NetTAP_COLLECTOR_TOKEN=${issuedToken} ./install-linux.sh`}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        copy(
                          `NetTAP_CONSOLE_URL=${origin} NetTAP_COLLECTOR_TOKEN=${issuedToken} ./install-linux.sh`,
                          "Install command",
                        )
                      }
                    >
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      Copy
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Interfaces + utilization */}
          <section className="rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Network className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Interfaces &amp; utilization</h2>
              </div>
              <div className="flex items-center gap-2">
                {[5, 15, 60, 240].map((minutes) => (
                  <Button
                    key={minutes}
                    size="sm"
                    variant={window === minutes ? "secondary" : "ghost"}
                    onClick={() => setWindow(minutes)}
                  >
                    {minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 p-4 lg:grid-cols-[280px_1fr]">
              <div className="space-y-1.5">
                {interfaces.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Interfaces appear here after the appliance checks in and enumerates the LAN
                    adapters on its host.
                  </p>
                )}
                {interfaces.map((iface) => {
                  const enabled =
                    draft?.captures.find((capture) => capture.interface_name === iface.name)
                      ?.enabled ?? iface.capture_enabled;
                  return (
                    <div
                      key={iface.id}
                      className={`rounded-md border px-3 py-2 ${
                        selectedInterface === iface.name
                          ? "border-primary/50 bg-primary/5"
                          : "border-border"
                      }`}
                    >
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => setSelectedInterface(iface.name)}
                      >
                        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <span className="truncate">{iface.name}</span>
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              iface.is_up ? "bg-primary" : "bg-muted-foreground"
                            }`}
                          />
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {iface.description ?? iface.addresses[0] ?? "no address"}
                          {iface.link_speed_bps
                            ? ` · ${formatBitsPerSecond(iface.link_speed_bps)}`
                            : ""}
                        </p>
                      </button>
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground">Capture packets</span>
                        <Switch
                          checked={enabled}
                          disabled={!draft}
                          onCheckedChange={(value) => toggleCapture(iface.name, value)}
                          aria-label={`Capture on ${iface.name}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5 text-primary" />
                    {selectedInterface ?? "no interface"}
                  </span>
                  {latest && (
                    <>
                      <span>in {formatBitsPerSecond(latest.rx)}</span>
                      <span>out {formatBitsPerSecond(latest.tx)}</span>
                      <span>peak {formatBitsPerSecond(peak)}</span>
                      {latest.utilization !== null && latest.utilization !== undefined && (
                        <span>{latest.utilization.toFixed(1)}% of link</span>
                      )}
                    </>
                  )}
                </div>
                <div className="h-64 w-full">
                  {chart.length === 0 ? (
                    <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
                      No counters for this window yet.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chart}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="time"
                          tick={{ fontSize: 11 }}
                          stroke="hsl(var(--muted-foreground))"
                          minTickGap={40}
                        />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          stroke="hsl(var(--muted-foreground))"
                          tickFormatter={(value: number) => formatBitsPerSecond(value)}
                          width={80}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                          formatter={(value: number) => formatBitsPerSecond(value)}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Area
                          type="monotone"
                          dataKey="rx"
                          name="Inbound"
                          stroke="hsl(var(--primary))"
                          fill="hsl(var(--primary))"
                          fillOpacity={0.2}
                        />
                        <Area
                          type="monotone"
                          dataKey="tx"
                          name="Outbound"
                          stroke="hsl(var(--chart-2, var(--muted-foreground)))"
                          fill="hsl(var(--chart-2, var(--muted-foreground)))"
                          fillOpacity={0.15}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Flow receivers */}
          {draft && (
            <section className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <RouterIcon className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">
                    Flow receivers (NetFlow / IPFIX / sFlow)
                  </h2>
                </div>
                <Button
                  size="sm"
                  disabled={!dirty || saveMutation.isPending}
                  onClick={() => saveMutation.mutate(draft)}
                >
                  Publish configuration
                </Button>
              </div>
              <div className="space-y-3 p-4">
                {draft.flow_receivers.map((receiver, index) => (
                  <div
                    key={receiver.protocol}
                    className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3"
                  >
                    <div className="flex items-center gap-2 pb-2">
                      <Switch
                        checked={receiver.enabled}
                        onCheckedChange={(value) => updateReceiver(index, { enabled: value })}
                        aria-label={`Enable ${receiver.protocol}`}
                      />
                      <span className="text-sm font-medium uppercase text-foreground">
                        {receiver.protocol}
                      </span>
                    </div>
                    <div className="w-28 space-y-1">
                      <Label className="text-xs">UDP port</Label>
                      <Input
                        type="number"
                        value={receiver.port}
                        onChange={(event) =>
                          updateReceiver(index, { port: Number(event.target.value) || 0 })
                        }
                      />
                    </div>
                    <div className="w-40 space-y-1">
                      <Label className="text-xs">Bind address</Label>
                      <Input
                        value={receiver.bind_address}
                        onChange={(event) => updateReceiver(index, { bind_address: event.target.value })}
                      />
                    </div>
                    <div className="min-w-48 grow space-y-1">
                      <Label className="text-xs">Exporter allowlist (comma separated)</Label>
                      <Input
                        value={receiver.allow_exporters.join(", ")}
                        placeholder="empty = accept all exporters"
                        onChange={(event) =>
                          updateReceiver(index, {
                            allow_exporters: event.target.value
                              .split(",")
                              .map((value) => value.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </div>
                    <div className="w-44 space-y-1">
                      <Label className="text-xs">Vantage</Label>
                      <Select
                        value={receiver.vantage}
                        onValueChange={(value) => updateReceiver(index, { vantage: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CAPTURE_VANTAGES.map((vantage) => (
                            <SelectItem key={vantage.value} value={vantage.value}>
                              {vantage.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Point your switches, routers and firewalls at the appliance IP on these ports. Open
                  them inbound on the VM firewall; only outbound HTTPS to this console is required.
                </p>
              </div>
            </section>
          )}

          {/* Exporters + probes */}
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-lg border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">Flow exporters seen</h2>
              </div>
              <div className="divide-y divide-border">
                {(data?.exporters ?? []).length === 0 && (
                  <p className="px-4 py-3 text-xs text-muted-foreground">
                    No exporters have sent flows yet.
                  </p>
                )}
                {(data?.exporters ?? []).map((exporter) => (
                  <div
                    key={`${exporter.exporter_ip}-${exporter.protocol}`}
                    className="flex items-center justify-between px-4 py-2.5 text-xs"
                  >
                    <div>
                      <p className="font-mono text-foreground">{exporter.exporter_ip}</p>
                      <p className="text-muted-foreground">
                        {exporter.protocol.toUpperCase()}
                        {exporter.version ? ` v${exporter.version}` : ""} · {exporter.templates}{" "}
                        templates
                        {exporter.sampling_rate ? ` · 1:${exporter.sampling_rate} sampled` : ""}
                      </p>
                    </div>
                    <div className="text-right text-muted-foreground">
                      <p>{exporter.flows.toLocaleString()} flows</p>
                      {exporter.packets_dropped > 0 && (
                        <p className="text-destructive">
                          {exporter.packets_dropped.toLocaleString()} dropped
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">
                  Monitors (ICMP · SNMP · WMI)
                </h2>
              </div>
              <div className="divide-y divide-border">
                {(data?.probes ?? []).length === 0 && (
                  <p className="px-4 py-3 text-xs text-muted-foreground">
                    No probe results in the last hour. Add targets to the appliance configuration to
                    start polling.
                  </p>
                )}
                {(data?.probes ?? []).slice(0, 12).map((probe) => (
                  <div
                    key={`${probe.kind}-${probe.target}-${probe.metric}`}
                    className="flex items-center justify-between px-4 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-foreground">{probe.target}</p>
                      <p className="text-muted-foreground">
                        {probe.kind.toUpperCase()} · {probe.metric}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-foreground">
                        {probe.latest !== null
                          ? `${probe.latest.toFixed(2)}${probe.unit ? ` ${probe.unit}` : ""}`
                          : (probe.latest_text ?? "—")}
                      </p>
                      <p
                        className={
                          probe.status === "ok" ? "text-muted-foreground" : "text-destructive"
                        }
                      >
                        {probe.status}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Events */}
          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">Appliance events</h2>
            </div>
            <div className="divide-y divide-border">
              {(data?.events ?? []).length === 0 && (
                <p className="px-4 py-3 text-xs text-muted-foreground">No events reported.</p>
              )}
              {(data?.events ?? []).slice(0, 20).map((event) => (
                <div key={event.id} className="flex items-start gap-3 px-4 py-2.5 text-xs">
                  <Badge
                    variant="outline"
                    className={
                      event.level === "error"
                        ? "border-destructive/40 text-destructive"
                        : event.level === "warn"
                          ? "border-amber-500/40 text-amber-500"
                          : "border-border text-muted-foreground"
                    }
                  >
                    {event.level}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-foreground">{event.message}</p>
                    <p className="text-muted-foreground">
                      {event.kind} · {new Date(event.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </ScrollArea>
    </AppShell>
  );
}
