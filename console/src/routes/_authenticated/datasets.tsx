import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { type DragEvent, useRef, useState } from "react";
import { FileUp, Loader2, MessageSquare, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { deleteDataset, ingestDataset, listDatasets } from "@/lib/datasets.functions";
import { createInvestigation } from "@/lib/investigations.functions";
import {
  CAPTURE_VANTAGES,
  DATASET_KIND_LABELS,
  describeVantage,
  type CaptureVantage,
  type IngestPayload,
} from "@/lib/ingest-types";
import { decodeCapture, isCaptureFile, readCaptureBuffer } from "@/lib/pcap-parse";
import { applyDecryption } from "@/lib/decrypt-capture";
import { hasKeyMaterial, loadKeys } from "@/lib/decrypt-keys";
import { decodeTsharkExport, detectTsharkExport } from "@/lib/tshark-import";
import { inspectTelemetryFile, type PreflightSummary } from "@/lib/preflight";
import {
  BROWSER_STREAMING_HINT_BYTES,
  describeIngestLimits,
  getIngestLimits,
} from "@/lib/ingest-capacity";
import { formatLimitBytes } from "@/lib/capacity";

import {
  FLOW_FIELDS,
  type DatasetKind,
  type FlowColumnMapping,
} from "@/lib/telemetry-parse";

export const Route = createFileRoute("/_authenticated/datasets")({
  head: () => ({
    meta: [
      { title: "Telemetry datasets — NetTAP AI" },
      {
        name: "description",
        content:
          "Upload NetTAP packet-broker captures (pcap/pcapng), IPFIX/NetFlow exports, syslog, SNMP counters and WMI records for AI investigation.",
      },
      { property: "og:title", content: "Telemetry datasets — NetTAP AI" },
      {
        property: "og:description",
        content: "Manage the network telemetry datasets your investigations query.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DatasetsPage,
});

const KIND_HINTS: { value: "" | DatasetKind; label: string }[] = [
  { value: "", label: "Detect automatically" },
  { value: "flow", label: "IPFIX / NetFlow" },
  { value: "log", label: "Device / syslog" },
  { value: "snmp", label: "SNMP metrics" },
  { value: "wmi", label: "WMI / Windows" },
];

type FileFormat = "auto" | "pcapng" | "pcap" | "csv" | "tshark" | "text";

const FILE_FORMATS: { value: FileFormat; label: string; accept: string }[] = [
  {
    value: "auto",
    label: "Detect automatically",
    accept: ".pcap,.pcapng,.cap,.gz,.csv,.tsv,.json,.log,.txt,.xml",
  },
  { value: "pcapng", label: "Packet capture — .pcapng", accept: ".pcapng,.pcapng.gz" },
  { value: "pcap", label: "Packet capture — .pcap / .cap", accept: ".pcap,.cap,.pcap.gz,.cap.gz" },
  { value: "csv", label: "CSV / TSV table (IPFIX, NetFlow, broker export)", accept: ".csv,.tsv" },
  {
    value: "tshark",
    label: "Wireshark / tshark decode export (json, ek, pdml, fields)",
    accept: ".json,.pdml,.xml,.txt,.csv,.tsv",
  },
  { value: "text", label: "Syslog / plain text", accept: ".log,.txt" },
];

function validateFile(nextFile: File) {
  if (nextFile.size === 0) throw new Error("That file is empty.");
  const limits = getIngestLimits();
  if (limits.max_import_bytes > 0 && nextFile.size > limits.max_import_bytes) {
    throw new Error(
      `This file is ${formatLimitBytes(nextFile.size)} and the browser ingest limit is ${formatLimitBytes(
        limits.max_import_bytes,
      )}. Raise it on the Capacity page, or drop the file into the appliance import folder, which streams any size.`,
    );
  }
}


function DatasetsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchDatasets = useServerFn(listDatasets);
  const ingest = useServerFn(ingestDataset);
  const remove = useServerFn(deleteDataset);
  const createThread = useServerFn(createInvestigation);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState("");
  const [tap, setTap] = useState("");
  const [hint, setHint] = useState<"" | DatasetKind>("");
  const [format, setFormat] = useState<FileFormat>("auto");
  const [vantage, setVantage] = useState<CaptureVantage>("unknown");
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [preflight, setPreflight] = useState<PreflightSummary | null>(null);
  const [preflightError, setPreflightError] = useState("");
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [mapping, setMapping] = useState<FlowColumnMapping>({});

  async function runPreflight(nextFile: File, nextFormat: FileFormat) {
    setPreflightBusy(true);
    setPreflight(null);
    setPreflightError("");
    try {
      const summary = await inspectTelemetryFile(nextFile, nextFormat, tap.trim() || undefined);
      setPreflight(summary);
      setMapping(summary.route === "table" ? { ...summary.suggestedMapping } : {});
    } catch (error) {
      setPreflightError(
        error instanceof Error ? error.message : "This file could not be inspected.",
      );
    } finally {
      setPreflightBusy(false);
    }
  }

  function chooseFile(nextFile: File | null) {
    if (!nextFile) return;
    try {
      validateFile(nextFile);
      setFile(nextFile);
      if (!name.trim()) setName(nextFile.name.replace(/\.[^.]+$/, ""));
      void runPreflight(nextFile, format);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "This file cannot be selected.");
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    chooseFile(event.dataTransfer.files?.[0] ?? null);
  }

  const { data: datasets, isLoading } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => fetchDatasets(),
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a telemetry file first.");
      const payload: IngestPayload = {
        name: name || file.name,
        filename: file.name,
      };
      if (hint) payload.hint = hint;
      if (isTable) {
        if (!mapping.src_ip || !mapping.dst_ip) {
          throw new Error("Map both the source IP and destination IP columns before ingesting.");
        }
        payload.columnMapping = mapping;
      }
      if (tap.trim()) payload.observationPoint = tap.trim();
      payload.vantage = vantage;

      const binaryCapture =
        format === "pcap" || format === "pcapng"
          ? true
          : format === "auto"
            ? isCaptureFile(file.name)
            : false;

      if (binaryCapture) {
        setStage("Decoding capture in your browser...");
        const buffer = await readCaptureBuffer(file);
        let decoded = decodeCapture(buffer, tap.trim() || undefined);
        const keys = loadKeys();
        if (hasKeyMaterial(keys)) {
          setStage("Decrypting with your local keys...");
          const result = await applyDecryption(buffer, decoded, keys);
          decoded = result.decoded;
          if (result.summary.addedRecords > 0) {
            toast.success(
              `Decrypted ${result.summary.tlsDecryptedSessions} TLS session(s) and ${result.summary.wifiDecryptedFrames} Wi-Fi frame(s).`,
            );
          } else if (result.summary.notes.length > 0) {
            toast.warning(result.summary.notes[0]!);
          }
        }
        payload.capture = {
          packets: decoded.packets,
          flows: decoded.flows,
          totalPackets: decoded.totalPackets,
          skipped: decoded.skipped,
          sampled: decoded.sampled,
        };

      } else {
        setStage("Reading file...");
        const text = await file.text();
        if (format === "tshark" || (format === "auto" && detectTsharkExport(file.name, text))) {
          // Wireshark/tshark decode export — reuse Wireshark's dissection.
          setStage("Reading Wireshark decode...");
          const decoded = decodeTsharkExport(text, file.name, tap.trim() || undefined);
          payload.capture = {
            packets: decoded.packets,
            flows: decoded.flows,
            totalPackets: decoded.totalPackets,
            skipped: decoded.skipped,
            sampled: decoded.sampled,
          };
        } else {
          payload.text = text;
        }
      }


      setStage("Storing and indexing...");
      return ingest({ data: payload });
    },
    onSuccess: async (result) => {
      toast.success(
        `Indexed ${result.records.toLocaleString()} ${result.kind} records into ${result.chunks} searchable summaries.${result.note ? ` ${result.note}` : ""}`,
      );
      setFile(null);
      setName("");
      setStage("");
      setPreflight(null);
      setPreflightError("");
      setMapping({});
      if (fileRef.current) fileRef.current.value = "";
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
    },
    onError: (error: Error) => {
      setStage("");
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      toast.success("Dataset removed.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const askMutation = useMutation({
    mutationFn: (dataset: { id: string; name: string }) =>
      createThread({ data: { title: `Investigate ${dataset.name}`, datasetId: dataset.id } }),
    onSuccess: async (thread) => {
      await queryClient.invalidateQueries({ queryKey: ["investigations"] });
      navigate({ to: "/investigations/$threadId", params: { threadId: thread.id } });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const isTable = preflight?.route === "table";
  const mappingIncomplete = isTable && (!mapping.src_ip || !mapping.dst_ip);
  const columnOptions = preflight?.normalizedColumns ?? [];

  return (
    <AppShell>
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Telemetry datasets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Packet captures (.pcap/.pcapng/.cap, gzip included), Wireshark/tshark decode exports,
          IPFIX/NetFlow or packet-broker CSV, device/syslog text, SNMP counter tables and
          WMI/Windows dumps. Everything is parsed, stored and indexed for the local
          nettap-packet-expert model.
        </p>

      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-6">
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold tracking-tight">Ingest telemetry</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="dataset-name">Dataset name</Label>
                <Input
                  id="dataset-name"
                  placeholder="DC1-EDGE broker — 2024-06-12"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="dataset-file">Telemetry file</Label>
                <div
                  className={`flex min-h-28 items-center justify-center border border-dashed px-4 py-5 transition-colors ${isDragging ? "border-primary bg-accent" : "border-input bg-background"}`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <Input
                    id="dataset-file"
                    type="file"
                    ref={fileRef}
                    accept={FILE_FORMATS.find((option) => option.value === format)?.accept}
                    className="sr-only"
                    onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
                  />
                  {file ? (
                    <div className="flex w-full items-center gap-3">
                      <FileUp className="h-5 w-5 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(file.size / 1024 / 1024).toFixed(2)} MB · ready to ingest
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Remove selected file"
                        onClick={() => {
                          setFile(null);
                          setPreflight(null);
                          setPreflightError("");
                          if (fileRef.current) fileRef.current.value = "";
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="text-center">
                      <FileUp className="mx-auto h-6 w-6 text-primary" />
                      <p className="mt-2 text-sm font-medium">Drop a telemetry file here</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        .pcap, .pcapng, .cap (plus .gz), Wireshark/tshark decode exports (-T json /
                        ek / pdml / fields), CSV, TSV, JSON, LOG and TXT — {describeIngestLimits()}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Limits are configurable on the Capacity page. Files over{" "}
                        {formatLimitBytes(BROWSER_STREAMING_HINT_BYTES)} import faster through the
                        appliance spool folder, which streams instead of decoding in this tab.

                      </p>

                      <Button asChild type="button" size="sm" variant="outline" className="mt-3">
                        <label htmlFor="dataset-file">Browse files</label>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              {(preflightBusy || preflight || preflightError) && (
                <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3 sm:col-span-2">
                  {preflightBusy ? (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Inspecting file before ingest...
                    </p>
                  ) : preflightError ? (
                    <p className="text-xs text-destructive">{preflightError}</p>
                  ) : preflight ? (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold tracking-tight">
                        Preflight · {preflight.label}
                      </p>
                      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                        {typeof preflight.packetCount === "number" && (
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">Packets</dt>
                            <dd className="font-medium">
                              {preflight.packetCount.toLocaleString()}
                              {preflight.sampledTo
                                ? ` (ingesting ${preflight.sampledTo.toLocaleString()})`
                                : ""}
                            </dd>
                          </div>
                        )}
                        {typeof preflight.flowCount === "number" && (
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">Conversations</dt>
                            <dd className="font-medium">
                              {preflight.flowCount.toLocaleString()}
                            </dd>
                          </div>
                        )}
                        {typeof preflight.rowCount === "number" && (
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">Data rows</dt>
                            <dd className="font-medium">{preflight.rowCount.toLocaleString()}</dd>
                          </div>
                        )}
                        {typeof preflight.lineCount === "number" &&
                          typeof preflight.rowCount !== "number" && (
                            <div className="flex justify-between gap-3">
                              <dt className="text-muted-foreground">Lines</dt>
                              <dd className="font-medium">
                                {preflight.lineCount.toLocaleString()}
                              </dd>
                            </div>
                          )}
                        {preflight.firstSeen && (
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">First seen</dt>
                            <dd className="font-medium">
                              {new Date(preflight.firstSeen).toLocaleString()}
                            </dd>
                          </div>
                        )}
                        {preflight.lastSeen && (
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">Last seen</dt>
                            <dd className="font-medium">
                              {new Date(preflight.lastSeen).toLocaleString()}
                            </dd>
                          </div>
                        )}
                      </dl>
                      {preflight.protocols && preflight.protocols.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Top protocols: {preflight.protocols.join(", ")}
                        </p>
                      )}
                      {preflight.columns && preflight.columns.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            {preflight.columns.length} columns ({preflight.delimiter}-separated)
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {preflight.columns.map((column) => (
                              <span
                                key={column}
                                className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px]"
                              >
                                {column}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {preflight.warnings.map((warning) => (
                        <p key={warning} className="text-xs text-muted-foreground">
                          {warning}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
              {isTable && columnOptions.length > 0 && (
                <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3 sm:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold tracking-tight">Column mapping</p>
                      <p className="text-xs text-muted-foreground">
                        Confirm which columns hold the flow fields. Anything left unmapped is kept
                        as extra metadata on each record.
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setMapping({ ...preflight?.suggestedMapping })}
                    >
                      Reset to detected
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {FLOW_FIELDS.map((field) => {
                      const value = mapping[field.key] ?? "";
                      const sample = preflight?.sampleRows?.find((row) => row[value]?.trim())?.[
                        value
                      ];
                      const required = field.key === "src_ip" || field.key === "dst_ip";
                      return (
                        <div key={field.key} className="space-y-1">
                          <Label htmlFor={`map-${field.key}`} className="text-xs">
                            {field.label}
                            {required && <span className="ml-1 text-destructive">*</span>}
                          </Label>
                          <select
                            id={`map-${field.key}`}
                            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                            value={value}
                            onChange={(event) =>
                              setMapping((current) => ({
                                ...current,
                                [field.key]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Not mapped</option>
                            {columnOptions.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                          <p className="text-[11px] text-muted-foreground">
                            {sample ? `e.g. ${sample.slice(0, 40)}` : field.hint}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  {mappingIncomplete && (
                    <p className="text-xs text-destructive">
                      Source IP and destination IP are required before this table can be ingested.
                    </p>
                  )}
                </div>
              )}
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="dataset-vantage">Capture vantage point</Label>
                <select
                  id="dataset-vantage"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={vantage}
                  onChange={(event) => setVantage(event.target.value as CaptureVantage)}
                >
                  {CAPTURE_VANTAGES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {describeVantage(vantage).description} <span className="font-medium">Blind spots:</span>{" "}
                  {describeVantage(vantage).blindSpots}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dataset-tap">Observation point (optional)</Label>
                <Input
                  id="dataset-tap"
                  placeholder="NetTAP-DC1 / TAP port 3"
                  value={tap}
                  onChange={(event) => setTap(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dataset-format">File format</Label>
                <select
                  id="dataset-format"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={format}
                  onChange={(event) => {
                    const nextFormat = event.target.value as FileFormat;
                    setFormat(nextFormat);
                    if (file) void runPreflight(file, nextFormat);
                  }}
                >
                  {FILE_FORMATS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dataset-kind">Telemetry type</Label>
                <select
                  id="dataset-kind"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={hint}
                  onChange={(event) => setHint(event.target.value as "" | DatasetKind)}
                >
                  {KIND_HINTS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                onClick={() => uploadMutation.mutate()}
                disabled={uploadMutation.isPending || preflightBusy || !file || mappingIncomplete}
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {uploadMutation.isPending ? stage || "Working..." : "Ingest and index"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Captures are decoded locally in your browser, then packets and rolled-up
                conversations are stored. Up to 20,000 records per file (larger captures are
                evenly sampled).
              </p>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold tracking-tight">Indexed datasets</h2>
            </div>
            {isLoading && (
              <p className="px-5 py-6 text-sm text-muted-foreground">Loading datasets...</p>
            )}
            {!isLoading && (datasets ?? []).length === 0 && (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                Nothing ingested yet. Upload a capture, flow export or log file to begin.
              </p>
            )}
            <div className="divide-y divide-border">
              {(datasets ?? []).map((dataset) => (
                <div key={dataset.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{dataset.name}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {DATASET_KIND_LABELS[dataset.kind as DatasetKind] ?? dataset.kind} ·{" "}
                      {dataset.record_count.toLocaleString()} records · {dataset.chunk_count}{" "}
                      summaries ·{" "}
                      {dataset.range_start
                        ? `${dataset.range_start.slice(0, 19)} → ${dataset.range_end?.slice(0, 19) ?? "?"}`
                        : "no timestamps"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Vantage: {describeVantage(dataset.vantage).label}
                      {dataset.observation_point ? ` · ${dataset.observation_point}` : ""}
                    </p>
                  </div>
                  <span className="rounded-sm border border-border px-2 py-0.5 font-mono text-[10px] uppercase text-primary">
                    {dataset.status}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => askMutation.mutate({ id: dataset.id, name: dataset.name })}
                    disabled={askMutation.isPending}
                  >
                    <MessageSquare className="mr-2 h-3.5 w-3.5" />
                    Ask this dataset
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${dataset.name}`}
                    onClick={() => deleteMutation.mutate(dataset.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </ScrollArea>
    </AppShell>
  );
}
