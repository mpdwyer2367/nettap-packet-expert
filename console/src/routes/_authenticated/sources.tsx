import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { FileUp, Loader2, PlugZap, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  deleteBrokerSource,
  listBrokerSources,
  saveBrokerSource,
  syncBrokerSource,
  testBrokerConnection,
  type BrokerResourceInput,
} from "@/lib/broker.functions";
import type { DatasetKind } from "@/lib/telemetry-parse";

export const Route = createFileRoute("/_authenticated/sources")({
  head: () => ({
    meta: [
      { title: "Packet broker sources — NetTAP AI" },
      {
        name: "description",
        content:
          "Connect NetTAP packet brokers over their REST API and pull flow, log, SNMP and WMI telemetry straight into NetTAP AI datasets.",
      },
      { property: "og:title", content: "Packet broker sources — NetTAP AI" },
      {
        property: "og:description",
        content: "Register broker API endpoints and sync live telemetry into your datasets.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SourcesPage,
});

const DEFAULT_RESOURCES: BrokerResourceInput[] = [
  { label: "Flows", path: "api/v1/flows", kind: "flow" },
  { label: "Logs", path: "api/v1/logs", kind: "log" },
];

function SourcesPage() {
  const queryClient = useQueryClient();
  const fetchSources = useServerFn(listBrokerSources);
  const save = useServerFn(saveBrokerSource);
  const remove = useServerFn(deleteBrokerSource);
  const test = useServerFn(testBrokerConnection);
  const sync = useServerFn(syncBrokerSource);

  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [secretName, setSecretName] = useState("NETTAP_BROKER_TOKEN");
  const [authStyle, setAuthStyle] = useState("bearer");
  const [authHeader, setAuthHeader] = useState("X-Api-Key");
  const [resources, setResources] = useState<BrokerResourceInput[]>(DEFAULT_RESOURCES);

  const { data: sources, isLoading } = useQuery({
    queryKey: ["broker-sources"],
    queryFn: () => fetchSources(),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          name,
          base_url: baseUrl,
          auth_style: authStyle,
          auth_header: authStyle === "header" ? authHeader : null,
          secret_name: secretName,
          resources,
        },
      }),
    onSuccess: async () => {
      setName("");
      setBaseUrl("");
      setResources(DEFAULT_RESOURCES);
      await queryClient.invalidateQueries({ queryKey: ["broker-sources"] });
      toast.success("Broker source saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => test({ data: { id } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["broker-sources"] });
      if (result.ok) toast.success(`Broker reachable (${result.status}).`);
      else toast.error(`Broker check failed: ${result.status}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const syncMutation = useMutation({
    mutationFn: (input: { id: string; path: string }) => sync({ data: input }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["broker-sources"] });
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      toast.success(`Pulled ${result.records.toLocaleString()} ${result.kind} records.`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["broker-sources"] });
      toast.success("Source removed.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function updateResource(index: number, patch: Partial<BrokerResourceInput>) {
    setResources((current) =>
      current.map((resource, position) =>
        position === index ? { ...resource, ...patch } : resource,
      ),
    );
  }

  return (
    <AppShell>
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Packet broker sources</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Register a NetTAP packet broker (or any telemetry API) and pull flows, logs, SNMP counters
          or WMI records straight into a dataset. Credentials are read server-side from a stored
          secret — never from the browser.
        </p>
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-6">
          <section className="flex flex-wrap items-center gap-4 border border-border bg-card p-5">
            <FileUp className="h-6 w-6 text-primary" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold tracking-tight">Analyze files instead</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload PCAP, PCAPNG, NetFlow/IPFIX, logs, SNMP, WMI, CSV or JSON exports.
              </p>
            </div>
            <Button asChild>
              <Link to="/datasets">Upload telemetry</Link>
            </Button>
          </section>

          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold tracking-tight">Add a broker</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="broker-name">Name</Label>
                <Input
                  id="broker-name"
                  placeholder="NetTAP DC1 broker"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="broker-url">API base URL</Label>
                <Input
                  id="broker-url"
                  placeholder="https://nettap-dc1.example.net"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="broker-auth">Auth style</Label>
                <select
                  id="broker-auth"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={authStyle}
                  onChange={(event) => setAuthStyle(event.target.value)}
                >
                  <option value="bearer">Bearer token</option>
                  <option value="header">Custom header</option>
                  <option value="basic">Basic (user:pass in secret)</option>
                  <option value="none">No auth</option>
                </select>
              </div>
              {authStyle === "header" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="broker-header">Header name</Label>
                  <Input
                    id="broker-header"
                    value={authHeader}
                    onChange={(event) => setAuthHeader(event.target.value)}
                  />
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="broker-secret">Secret name holding the credential</Label>
                <Input
                  id="broker-secret"
                  value={secretName}
                  onChange={(event) => setSecretName(event.target.value)}
                />
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Resources to pull
              </p>
              {resources.map((resource, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[1fr_2fr_1fr]">
                  <Input
                    aria-label="Resource label"
                    value={resource.label}
                    onChange={(event) => updateResource(index, { label: event.target.value })}
                  />
                  <Input
                    aria-label="Resource path"
                    value={resource.path}
                    onChange={(event) => updateResource(index, { path: event.target.value })}
                  />
                  <select
                    aria-label="Telemetry type"
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={resource.kind}
                    onChange={(event) =>
                      updateResource(index, { kind: event.target.value as DatasetKind })
                    }
                  >
                    <option value="flow">Flow</option>
                    <option value="log">Log</option>
                    <option value="snmp">SNMP</option>
                    <option value="wmi">WMI</option>
                  </select>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setResources((current) => [...current, { label: "SNMP", path: "api/v1/snmp", kind: "snmp" }])
                }
              >
                Add resource
              </Button>
            </div>

            <Button
              className="mt-5"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PlugZap className="mr-2 h-4 w-4" />
              )}
              Save broker
            </Button>
          </section>

          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold tracking-tight">Connected brokers</h2>
            </div>
            {isLoading && (
              <p className="px-5 py-6 text-sm text-muted-foreground">Loading sources...</p>
            )}
            {!isLoading && (sources ?? []).length === 0 && (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                No brokers registered yet.
              </p>
            )}
            <div className="divide-y divide-border">
              {(sources ?? []).map((source) => (
                <div key={source.id} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{source.name}</p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {source.base_url} · {source.auth_style} ·{" "}
                        {source.last_status ?? "never tested"}
                        {source.last_synced_at ? ` · synced ${source.last_synced_at.slice(0, 19)}` : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => testMutation.mutate(source.id)}
                      disabled={testMutation.isPending}
                    >
                      Test
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${source.name}`}
                      onClick={() => deleteMutation.mutate(source.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {source.resources.map((resource) => (
                      <Button
                        key={`${source.id}-${resource.path}`}
                        size="sm"
                        variant="secondary"
                        onClick={() => syncMutation.mutate({ id: source.id, path: resource.path })}
                        disabled={syncMutation.isPending}
                      >
                        <RefreshCw className="mr-2 h-3.5 w-3.5" />
                        Sync {resource.label}
                      </Button>
                    ))}
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
