import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Check,
  Copy,
  Info,
  Pause,
  Play,
  RefreshCw,
  Square,
  Trash2,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { CAPTURE_VANTAGES, describeVantage } from "@/lib/ingest-types";
import {
  CAPTURE_OS_OPTIONS,
  describeCaptureOs,
  type CaptureOs,
  type LiveSessionSummary,
} from "@/lib/live-capture-types";
import { agentTokenEnvName, generateAgentScript } from "@/lib/live-agent-script";
import {
  createLiveSession,
  deleteLiveSession,
  finalizeLiveSession,
  getLiveMetrics,
  listLiveSessions,
  rotateLiveToken,
  setLiveSessionStatus,
} from "@/lib/live-capture.functions";

export const Route = createFileRoute("/_authenticated/live")({
  head: () => ({
    meta: [
      { title: "Live Wi-Fi capture — NetTAP AI" },
      {
        name: "description",
        content:
          "Stream packets from your own Wi-Fi or wired interface with a local Npcap/libpcap agent and watch live talkers, protocols and rates while you question the data.",
      },
      { property: "og:title", content: "Live Wi-Fi capture — NetTAP AI" },
      {
        property: "og:description",
        content:
          "Real-time packet monitoring from your Wi-Fi interface, streamed into the NetTAP analyst for live questions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LiveCapturePage,
});

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let index = 0;
  let size = value;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        toast.success(`${label} copied`);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}

function LiveCapturePage() {
  const queryClient = useQueryClient();
  const fetchSessions = useServerFn(listLiveSessions);
  const createSession = useServerFn(createLiveSession);
  const rotate = useServerFn(rotateLiveToken);
  const updateStatus = useServerFn(setLiveSessionStatus);
  const finalize = useServerFn(finalizeLiveSession);
  const remove = useServerFn(deleteLiveSession);
  const fetchMetrics = useServerFn(getLiveMetrics);

  const [os, setOs] = useState<CaptureOs>("windows");
  const [interfaceName, setInterfaceName] = useState("Wi-Fi");
  const [captureFilter, setCaptureFilter] = useState("");
  const [sliceSeconds, setSliceSeconds] = useState(5);
  const [vantage, setVantage] = useState("host_agent");
  const [name, setName] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState("");

  useEffect(() => {
    setEndpoint(`${window.location.origin}/api/public/live-ingest`);
  }, []);

  const { data: sessions } = useQuery({
    queryKey: ["live-sessions"],
    queryFn: () => fetchSessions(),
    refetchInterval: 5000,
  });

  const active: LiveSessionSummary | null = useMemo(() => {
    const list = sessions ?? [];
    return list.find((session) => session.id === activeId) ?? list[0] ?? null;
  }, [sessions, activeId]);

  const { data: metrics, refetch: refetchMetrics } = useQuery({
    queryKey: ["live-metrics", active?.id],
    queryFn: () => fetchMetrics({ data: { id: active!.id } }),
    enabled: Boolean(active?.id),
    refetchInterval: 4000,
  });

  // Realtime keeps the chart in step with the agent; polling above is the fallback.
  useEffect(() => {
    if (!active?.id) return;
    const channel = supabase
      .channel(`live-metrics-${active.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_session_metrics", filter: `session_id=eq.${active.id}` },
        () => {
          void refetchMetrics();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [active?.id, refetchMetrics]);

  const createMutation = useMutation({
    mutationFn: () =>
      createSession({
        data: {
          name,
          os,
          interfaceName,
          captureFilter,
          sliceSeconds,
          vantage,
          observationPoint: interfaceName,
        },
      }),
    onSuccess: async (result) => {
      setToken(result.token);
      setActiveId(result.sessionId);
      await queryClient.invalidateQueries({ queryKey: ["live-sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      toast.success("Session created — run the agent command to start streaming");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const statusMutation = useMutation({
    mutationFn: (input: { id: string; status: "live" | "paused" | "stopped" }) =>
      updateStatus({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["live-sessions"] }),
    onError: (error: Error) => toast.error(error.message),
  });

  const finalizeMutation = useMutation({
    mutationFn: (id: string) => finalize({ data: { id } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["live-sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      toast.success(`Finalized — ${result.packets.toLocaleString()} packets indexed into ${result.chunks} chunks`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id, deleteDataset: false } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["live-sessions"] });
      setToken(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rotateMutation = useMutation({
    mutationFn: (id: string) => rotate({ data: { id } }),
    onSuccess: (result) => {
      setToken(result.token);
      toast.success("New streaming token issued — the old one no longer works");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const osInfo = describeCaptureOs(active?.os ?? os);
  const script = active
    ? generateAgentScript({
        os: (active.os as CaptureOs) ?? "windows",
        endpoint,
        interfaceName: active.interface_name,
        captureFilter: active.capture_filter,
        sliceSeconds: active.slice_seconds,
      })
    : "";

  const buckets = metrics ?? [];
  const latest = buckets[buckets.length - 1];
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.packets));
  const windowBuckets = buckets.slice(-24);
  const talkers = latest?.top?.talkers ?? [];
  const protocols = latest?.top?.protocols ?? [];
  const ports = latest?.top?.ports ?? [];
  const staleFor = active?.last_seen_at
    ? Math.round((Date.now() - new Date(active.last_seen_at).getTime()) / 1000)
    : null;
  const agentLive = staleFor !== null && staleFor < (active?.slice_seconds ?? 5) * 3;

  return (
    <AppShell>
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 font-mono text-lg font-semibold tracking-tight">
            <Wifi className="h-4 w-4 text-primary" />
            Live capture
          </h1>
          <p className="text-xs text-muted-foreground">
            Stream your Wi-Fi or wired interface into the analyst with a local Npcap / libpcap agent.
          </p>
        </div>
        {active && (
          <Badge variant={agentLive ? "default" : "secondary"} className="font-mono text-[10px]">
            {agentLive ? "agent streaming" : active.status}
          </Badge>
        )}
      </header>

      <ScrollArea className="flex-1">
        <div className="grid gap-6 p-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <section className="space-y-4 rounded-lg border border-border bg-card p-4">
            <div>
              <h2 className="text-sm font-semibold">New session</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Your browser cannot open a network adapter, so capture runs in a small script on your
                machine and streams the decoded packets here.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="live-os">Operating system</Label>
              <Select value={os} onValueChange={(value) => setOs(value as CaptureOs)}>
                <SelectTrigger id="live-os">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAPTURE_OS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{describeCaptureOs(os).driver}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="live-iface">Interface</Label>
              <Input
                id="live-iface"
                value={interfaceName}
                onChange={(event) => setInterfaceName(event.target.value)}
                placeholder={os === "windows" ? "Wi-Fi" : os === "macos" ? "en0" : "wlan0"}
              />
              <p className="text-[11px] text-muted-foreground">
                Not sure? The agent prints <code className="font-mono">{describeCaptureOs(os).listCommand}</code>{" "}
                output before it starts — paste the interface name shown there.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="live-filter">Capture filter (BPF, optional)</Label>
              <Input
                id="live-filter"
                value={captureFilter}
                onChange={(event) => setCaptureFilter(event.target.value)}
                placeholder="not port 22 and not arp"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="live-slice">Slice seconds</Label>
                <Input
                  id="live-slice"
                  type="number"
                  min={2}
                  max={60}
                  value={sliceSeconds}
                  onChange={(event) => setSliceSeconds(Number(event.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="live-name">Session name</Label>
                <Input
                  id="live-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={`Live ${interfaceName}`}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="live-vantage">Capture vantage</Label>
              <Select value={vantage} onValueChange={setVantage}>
                <SelectTrigger id="live-vantage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAPTURE_VANTAGES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{describeVantage(vantage).blindSpots}</p>
            </div>

            <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-[11px] text-muted-foreground">
              <p className="flex items-center gap-1.5 font-medium text-foreground">
                <Info className="h-3.5 w-3.5" /> Wi-Fi reality check
              </p>
              <p className="mt-1">
                In normal (managed) mode a Wi-Fi adapter only sees this host&apos;s own traffic plus
                broadcast/multicast — not your neighbours&apos; sessions. {osInfo.monitorMode}
              </p>
              <p className="mt-1">{osInfo.notes}</p>
            </div>

            <Button
              className="w-full"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !interfaceName.trim()}
            >
              <Play className="mr-2 h-4 w-4" />
              {createMutation.isPending ? "Creating…" : "Create session"}
            </Button>
          </section>

          <section className="space-y-4">
            {!active && (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No live sessions yet. Create one to get a ready-to-run capture command.
              </div>
            )}

            {active && (
              <>
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-mono text-sm font-semibold">{active.dataset_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {active.interface_name} · {active.os} · {active.slice_seconds}s slices
                        {active.capture_filter ? ` · filter "${active.capture_filter}"` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {active.status === "paused" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => statusMutation.mutate({ id: active.id, status: "live" })}
                        >
                          <Play className="mr-1.5 h-3.5 w-3.5" /> Resume
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => statusMutation.mutate({ id: active.id, status: "paused" })}
                        >
                          <Pause className="mr-1.5 h-3.5 w-3.5" /> Pause ingest
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => finalizeMutation.mutate(active.id)}
                        disabled={finalizeMutation.isPending}
                      >
                        <Square className="mr-1.5 h-3.5 w-3.5" />
                        {finalizeMutation.isPending ? "Indexing…" : "Stop & finalize"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => rotateMutation.mutate(active.id)}
                        aria-label="Issue a new streaming token"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: "Packets", value: active.packet_count.toLocaleString() },
                      { label: "Volume", value: formatBytes(Number(active.byte_count)) },
                      {
                        label: "Packets / s",
                        value: latest
                          ? (latest.packets / Math.max(1, active.slice_seconds)).toFixed(1)
                          : "—",
                      },
                      {
                        label: "Agent last seen",
                        value: staleFor === null ? "never" : `${staleFor}s ago`,
                      },
                    ].map((stat) => (
                      <div key={stat.label} className="rounded-md border border-border/60 bg-muted/20 p-2.5">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {stat.label}
                        </p>
                        <p className="font-mono text-sm">{stat.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4">
                    <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      <Activity className="h-3 w-3" /> Packets per slice
                    </p>
                    <div className="flex h-24 items-end gap-1">
                      {windowBuckets.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          Waiting for the first slice from the agent…
                        </p>
                      )}
                      {windowBuckets.map((bucket) => (
                        <div
                          key={bucket.bucket_ts}
                          className="flex-1 rounded-sm bg-primary/70"
                          style={{ height: `${Math.max(4, (bucket.packets / peak) * 100)}%` }}
                          title={`${new Date(bucket.bucket_ts).toLocaleTimeString()} — ${bucket.packets} packets, ${formatBytes(Number(bucket.bytes))}`}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    {[
                      { title: "Top talkers", rows: talkers.map((row) => [row.ip, formatBytes(row.bytes)]) },
                      {
                        title: "Protocols",
                        rows: protocols.map((row) => [row.protocol, `${row.packets}`]),
                      },
                      { title: "Dest ports", rows: ports.map((row) => [`${row.port}`, `${row.packets}`]) },
                    ].map((card) => (
                      <div key={card.title} className="rounded-md border border-border/60 p-2.5">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {card.title}
                        </p>
                        <div className="mt-1.5 space-y-1">
                          {card.rows.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
                          {card.rows.map(([key, value]) => (
                            <div key={key} className="flex justify-between gap-2 font-mono text-[11px]">
                              <span className="truncate">{key}</span>
                              <span className="text-muted-foreground">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Ask questions about this stream while it runs — open an investigation and pick the{" "}
                    <Link to="/datasets" className="underline">
                      {active.dataset_name}
                    </Link>{" "}
                    dataset. Answers cover packets received so far, from a{" "}
                    {describeVantage(active.vantage).label.toLowerCase()} vantage.
                  </p>
                  {active.last_error && (
                    <p className="mt-2 text-[11px] text-destructive">Last agent error: {active.last_error}</p>
                  )}
                </div>

                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold">Run the agent</h2>
                      <p className="text-xs text-muted-foreground">
                        Paste this into {active.os === "windows" ? "an elevated PowerShell" : "a terminal"}{" "}
                        on the machine with the interface. Set{" "}
                        <code className="font-mono">{agentTokenEnvName()}</code> to the session token.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {token && <CopyButton value={token} label="Copy token" />}
                      <CopyButton value={script} label="Copy script" />
                    </div>
                  </div>

                  {token ? (
                    <p className="mt-3 break-all rounded-md border border-border/60 bg-muted/30 p-2 font-mono text-[11px]">
                      {token}
                    </p>
                  ) : (
                    <p className="mt-3 text-[11px] text-muted-foreground">
                      The token is only shown once. Use the refresh button above to issue a new one.
                    </p>
                  )}

                  <pre className="mt-3 max-h-80 overflow-auto rounded-md border border-border/60 bg-muted/20 p-3 font-mono text-[11px] leading-relaxed">
                    {script}
                  </pre>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Endpoint: <code className="font-mono">{endpoint}</code>
                  </p>
                </div>
              </>
            )}

            {(sessions ?? []).length > 1 && (
              <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-2 text-sm font-semibold">Sessions</h2>
                <div className="space-y-1">
                  {(sessions ?? []).map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40"
                    >
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          setActiveId(session.id);
                          setToken(null);
                        }}
                      >
                        <p className="truncate font-mono text-xs">{session.dataset_name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {session.interface_name} · {session.status} ·{" "}
                          {session.packet_count.toLocaleString()} packets
                        </p>
                      </button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Delete session"
                        onClick={() => deleteMutation.mutate(session.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </AppShell>
  );
}
