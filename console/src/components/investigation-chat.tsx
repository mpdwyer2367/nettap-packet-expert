import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Activity, CircleAlert, CircleCheck, Cpu, FileText, Radio, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { OllamaSettingsButton, useOllamaSettings } from "@/components/ollama-settings";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import logo from "@/assets/nettap-logo.png";
import { ChartBlock, DiagramBlock } from "@/components/telemetry-visuals";
import type { DatasetSummary } from "@/lib/datasets.functions";
import { appendInvestigationMessages } from "@/lib/investigations.functions";

import {
  readMessageEngine,
  runOllamaInvestigation,
  testOllamaConnection,
  type ChatMessage,
  type ChatPart,
} from "@/lib/ollama";
import { buildReportMarkdown, downloadMarkdown, extractVisuals } from "@/lib/report-builder";
import { saveReport } from "@/lib/reports.functions";


type FlowEvidence = {
  id: number;
  ts: string | null;
  src: string | null;
  dst: string | null;
  protocol: string | null;
  bytes: number | null;
  packets: number | null;
};

type LogEvidence = {
  id: number;
  ts: string | null;
  host: string | null;
  severity: string | null;
  message: string;
};

const STARTERS = [
  "Summarise this dataset and flag anything unusual.",
  "Which hosts moved the most bytes, and to where?",
  "Is there evidence of scanning or beaconing?",
  "Show the busiest conversations on non-standard ports.",
];

function formatBytes(bytes: number | null) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

function collectEvidence(messages: ChatMessage[]) {
  const flows = new Map<number, FlowEvidence>();
  const logs = new Map<number, LogEvidence>();

  for (const message of messages) {
    for (const part of message.parts) {
      if (!part.type.startsWith("tool-")) continue;
      const output = (part as { output?: unknown }).output as
        | { flows?: FlowEvidence[]; logs?: LogEvidence[] }
        | undefined;
      if (!output) continue;
      for (const flow of output.flows ?? []) flows.set(flow.id, flow);
      for (const log of output.logs ?? []) logs.set(log.id, log);
    }
  }

  return { flows: [...flows.values()].slice(0, 60), logs: [...logs.values()].slice(0, 60) };
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function InvestigationChat({
  threadId,
  initialMessages,
  datasets,
  datasetId,
  onDatasetChange,
  onFirstMessage,
}: {
  threadId: string;
  initialMessages: ChatMessage[];
  datasets: DatasetSummary[];
  datasetId: string | null;
  onDatasetChange: (datasetId: string) => void;
  onFirstMessage: (text: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [settings] = useOllamaSettings();
  const persistMessages = useServerFn(appendInvestigationMessages);
  const storeReport = useServerFn(saveReport);

  const [reporting, setReporting] = useState(false);
  const [testInProgress, setTestInProgress] = useState(false);
  const [connection, setConnection] = useState<"checking" | "ready" | "error">("checking");
  const [connectionMessage, setConnectionMessage] = useState("Checking local model...");


  const activeDataset = datasets.find((dataset) => dataset.id === datasetId) ?? null;
  const evidence = useMemo(() => collectEvidence(messages), [messages]);

  async function generateReport() {
    if (messages.length === 0) {
      toast.error("Ask at least one question before generating a report.");
      return;
    }
    setReporting(true);
    try {
      const title = `NetTAP report — ${activeDataset?.name ?? "telemetry"}`;
      const markdown = buildReportMarkdown({
        title,
        datasetName: activeDataset?.name ?? null,
        model: settings.model,
        messages,
      });
      await storeReport({
        data: {
          title,
          markdown,
          visuals: extractVisuals(messages),
          investigationId: threadId,
          datasetId,
        },
      });
      downloadMarkdown(`${title.replace(/[^\w.-]+/g, "-").toLowerCase()}.md`, markdown);
      toast.success("Report saved and downloaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not build the report.");
    } finally {
      setReporting(false);
    }
  }

  async function testLocalOllama() {
    setTestInProgress(true);
    try {
      const result = await testOllamaConnection(settings, { verifyLoad: true });
      if (result.ok) {
        toast.success(result.message);
        setConnection("ready");
      } else {
        toast.error(result.message);
        setConnection("error");
      }
      setConnectionMessage(result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not test Ollama.";
      toast.error(message);
      setConnection("error");
      setConnectionMessage(message);
    } finally {
      setTestInProgress(false);
    }
  }



  useEffect(() => {
    if (!busy) textareaRef.current?.focus();
  }, [busy, threadId]);

  // Background health check: keeps polling the local Ollama server so the chat
  // flips back to ready the moment the appliance-managed model is reachable.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const lastStatusRef = useRef<"checking" | "ready" | "error">("checking");

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    setConnection("checking");
    lastStatusRef.current = "checking";

    const check = async () => {
      if (!active) return;
      // Don't probe mid-answer: switching engines during a turn would be confusing.
      if (busyRef.current || (typeof document !== "undefined" && document.hidden)) {
        schedule(5000);
        return;
      }
      const result = await testOllamaConnection(settings);
      if (!active) return;
      const next = result.ok ? "ready" : "error";
      setConnection(next);
      setConnectionMessage(result.message);
      if (lastStatusRef.current !== "checking" && lastStatusRef.current !== next) {
        toast[next === "ready" ? "success" : "info"](
          next === "ready"
            ? `Local model online — switched to ${settings.model}.`
            : "Managed model offline — investigation chat is paused.",
        );
      }
      lastStatusRef.current = next;
      schedule(next === "ready" ? 20000 : 8000);
    };

    function schedule(delay: number) {
      if (!active) return;
      timer = setTimeout(() => void check(), delay);
    }

    void check();

    const recheck = () => {
      if (timer) clearTimeout(timer);
      void check();
    };
    window.addEventListener("online", recheck);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", recheck);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [settings]);

  async function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    if (!datasetId) {
      toast.error("Pick a telemetry dataset for this investigation first.");
      return;
    }
    if (messages.length === 0) onFirstMessage(trimmed);

    const userMessage: ChatMessage = {
      id: newId(),
      role: "user",
      parts: [{ type: "text", text: trimmed }],
    };
    const history = [...messages, userMessage];
    const assistantId = newId();

    setMessages([...history, { id: assistantId, role: "assistant", parts: [] }]);
    setBusy(true);

    const applyParts = (parts: ChatPart[]) => {
      setMessages((current) =>
        current.map((message) => (message.id === assistantId ? { ...message, parts } : message)),
      );
    };

    if (connection !== "ready") {
      toast.error("The managed NetTAP model is not ready.");
      setBusy(false);
      return;
    }
    const enginePart: ChatPart = { type: "engine", engine: "managed", model: settings.model };

    try {
      let parts = await runOllamaInvestigation({
        settings,
        datasetId,
        history,
        onParts: (streamed) => applyParts([enginePart, ...streamed]),
      });
      parts = [enginePart, ...parts];
      applyParts(parts);
      await persistMessages({
        data: {
          id: threadId,
          messages: [
            { messageId: userMessage.id, role: "user", parts: JSON.stringify(userMessage.parts) },
            { messageId: assistantId, role: "assistant", parts: JSON.stringify(parts) },
          ],
        },
      }).catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The model could not answer that.";
      toast.error(message);
      applyParts([enginePart, { type: "text", text: `**Model error** — ${message}` }]);
    } finally {
      setBusy(false);
    }
  }


  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Active dataset
            </p>
            <p className="truncate font-mono text-sm">
              {activeDataset
                ? `${activeDataset.name} · ${activeDataset.record_count.toLocaleString()} ${activeDataset.kind} records`
                : "No dataset bound"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void generateReport()}
              disabled={reporting || messages.length === 0}
            >
              <FileText className="mr-2 h-4 w-4" />
              {reporting ? "Building..." : "Report"}
            </Button>
            <OllamaSettingsButton settings={settings} />
            <Button
              variant="outline"
              size="sm"
              disabled={testInProgress || busy}
              onClick={() => void testLocalOllama()}
              className="gap-2"
            >
              {testInProgress ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Activity className="h-4 w-4" />
              )}
              Test NetTAP model
            </Button>


            <Select value={datasetId ?? ""} onValueChange={onDatasetChange}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Bind a dataset" />
              </SelectTrigger>
              <SelectContent>
                {datasets.map((dataset) => (
                  <SelectItem key={dataset.id} value={dataset.id}>
                    {dataset.name} ({dataset.kind})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </header>

        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl px-5 py-6">
            {connection !== "ready" && (
              <div className="mb-5 flex items-start gap-3 border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {connection === "checking"
                      ? "Checking local model"
                      : "Managed NetTAP model unavailable"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed">
                    {connection === "checking"
                      ? connectionMessage
                      : `${connectionMessage} Investigation chat is disabled until the appliance model is healthy; no cloud fallback is used.`}
                  </p>
                </div>
              </div>
            )}

            {messages.length === 0 && (
              <ConversationEmptyState
                icon={<img src={logo} alt="" width={40} height={40} className="h-10 w-10" />}
                title="Ask the telemetry"
                description="Powered by the appliance-managed NetTAP model. Query flows, IPFIX/NetFlow records and device logs — answers cite the records they came from."
              >
                <div className="mt-4 grid gap-2">
                  {STARTERS.map((starter) => (
                    <Button
                      key={starter}
                      variant="outline"
                      size="sm"
                      className="justify-start text-left font-normal"
                      onClick={() => void submit(starter)}
                    >
                      {starter}
                    </Button>
                  ))}
                </div>
              </ConversationEmptyState>
            )}

            {messages.map((message) => {
              const engine =
                message.role === "assistant" ? readMessageEngine(message.parts) : null;
              return (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  {engine && (
                    <span
                      className={`mb-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
                        engine.engine === "managed" || engine.engine === "local"
                          ? "border-primary/40 text-primary"
                          : "border-border text-muted-foreground"
                      }`}
                      title={
                        engine.engine === "managed"
                          ? "Answered by the appliance-managed NetTAP model"
                          : engine.engine === "local"
                            ? "Answered by a legacy browser-local Ollama configuration"
                            : "Legacy hosted-model answer"
                      }
                    >
                      {engine.engine === "managed" || engine.engine === "local" ? (
                        <Cpu className="h-3 w-3" />
                      ) : (
                        <CircleAlert className="h-3 w-3" />
                      )}
                      {engine.engine === "managed"
                        ? "Managed Ollama"
                        : engine.engine === "local"
                          ? "Legacy local Ollama"
                          : "Legacy hosted answer"}
                      {engine.model ? ` · ${engine.model}` : ""}
                    </span>
                  )}
                  {message.parts.map((part, index) => {
                    if (part.type === "engine") return null;
                    if (part.type === "text") {
                      return (
                        <MessageResponse key={`${message.id}-text-${index}`}>
                          {part.text}
                        </MessageResponse>
                      );
                    }

                    if (part.type.startsWith("tool-")) {
                      const toolPart = part as Extract<ChatPart, { state: string }>;
                      const output = toolPart.output as
                        | {
                            chart?: {
                              type?: string;
                              title?: string;
                              y_label?: string | null;
                              points?: { label: string; value: number }[];
                            };
                            diagram?: { title?: string; mermaid?: string };
                          }
                        | undefined;

                      if (output?.chart?.points?.length) {
                        return (
                          <ChartBlock
                            key={`${message.id}-chart-${index}`}
                            title={output.chart.title ?? "Chart"}
                            chartType={output.chart.type ?? "line"}
                            points={output.chart.points}
                            yLabel={output.chart.y_label ?? null}
                          />
                        );
                      }
                      if (output?.diagram?.mermaid) {
                        return (
                          <DiagramBlock
                            key={`${message.id}-diagram-${index}`}
                            title={output.diagram.title ?? "Diagram"}
                            mermaid={output.diagram.mermaid}
                          />
                        );
                      }

                      return (
                        <Tool key={`${message.id}-tool-${index}`} defaultOpen={false}>
                          <ToolHeader
                            type={toolPart.type as `tool-${string}`}
                            state={toolPart.state}
                          />
                          <ToolContent>
                            <ToolInput input={toolPart.input} />
                            <ToolOutput
                              output={
                                toolPart.output ? (
                                  <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed">
                                    {JSON.stringify(toolPart.output, null, 2).slice(0, 4000)}
                                  </pre>
                                ) : undefined
                              }
                              errorText={toolPart.errorText}
                            />
                          </ToolContent>
                        </Tool>
                      );
                    }

                    return null;
                  })}
                </MessageContent>
              </Message>
              );
            })}

            {busy && (
              <div className="flex items-center gap-2 text-sm">
                <Activity className="h-4 w-4 text-primary" />
                <Shimmer>{`Correlating telemetry with ${settings.model}...`}</Shimmer>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t border-border px-5 py-4">
          <div className="mx-auto w-full max-w-3xl">
            <PromptInput onSubmit={(message) => void submit(message.text ?? "")}>
              <PromptInputTextarea
                ref={textareaRef}
                placeholder={
                  datasetId
                    ? "Ask about talkers, ports, protocols, anomalies, hosts..."
                    : "Bind a dataset to start asking questions"
                }
                disabled={busy}
              />
              <PromptInputFooter>
                <p className="px-1 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    {connection === "ready" ? (
                      <CircleCheck className="h-3 w-3 text-primary" />
                    ) : (
                      <CircleAlert className="h-3 w-3 text-muted-foreground" />
                    )}
                    {connection === "ready"
                      ? `Managed model · ${settings.model}`
                      : "Managed model unavailable · no cloud fallback"}
                  </span>
                </p>
                <PromptInputSubmit
                  status={busy ? "streaming" : "ready"}
                  disabled={busy || !datasetId || connection === "checking"}
                />

              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      </div>

      <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-sidebar lg:flex">
        <div className="border-b border-border px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Evidence
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Records the analyst pulled while answering.
          </p>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-2 p-3">
            {evidence.flows.length === 0 && evidence.logs.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No records retrieved yet. Ask a question to populate evidence.
              </p>
            )}
            {evidence.flows.map((flow) => (
              <div key={`flow-${flow.id}`} className="rounded-md border border-border bg-card p-2.5">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1 font-mono">
                    <Radio className="h-3 w-3 text-primary" />
                    flow #{flow.id}
                  </span>
                  <span>{flow.ts ? new Date(flow.ts).toISOString().slice(0, 19) : "no ts"}</span>
                </div>
                <p className="mt-1 break-all font-mono text-xs">
                  {flow.src ?? "?"} → {flow.dst ?? "?"}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {flow.protocol ?? "?"} · {formatBytes(flow.bytes)} · {flow.packets ?? 0} pkts
                </p>
              </div>
            ))}
            {evidence.logs.map((log) => (
              <div key={`log-${log.id}`} className="rounded-md border border-border bg-card p-2.5">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1 font-mono">
                    <FileText className="h-3 w-3 text-primary" />
                    log #{log.id}
                  </span>
                  <span>{log.severity ?? "info"}</span>
                </div>
                <p className="mt-1 break-words font-mono text-[11px] leading-relaxed">
                  {log.message.slice(0, 240)}
                </p>
              </div>
            ))}
          </div>
        </ScrollArea>
      </aside>
    </div>
  );
}
