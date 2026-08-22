import type { ChatMessage } from "@/lib/ollama";
import type { ReportVisual } from "@/lib/reports.functions";

type ToolOutput = {
  chart?: { type?: string; title?: string; y_label?: string | null; points?: { label: string; value: number }[] };
  diagram?: { title?: string; mermaid?: string };
  flows?: { id: number; ts: string | null; src: string | null; dst: string | null; protocol: string | null; bytes: number | null }[];
  logs?: { id: number; ts: string | null; host: string | null; severity: string | null; message: string }[];
  packets?: { id: number; ts: string | null; src: string | null; dst: string | null; protocol: string | null; length: number | null }[];
};

function outputs(messages: ChatMessage[]) {
  const found: ToolOutput[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (!part.type.startsWith("tool-")) continue;
      const output = (part as { output?: unknown }).output as ToolOutput | undefined;
      if (output && typeof output === "object") found.push(output);
    }
  }
  return found;
}

/** Charts and diagrams the model asked the UI to render, in order. */
export function extractVisuals(messages: ChatMessage[]): ReportVisual[] {
  const visuals: ReportVisual[] = [];
  for (const output of outputs(messages)) {
    if (output.chart?.points?.length) {
      visuals.push({
        type: "chart",
        title: output.chart.title ?? "Chart",
        chartType: output.chart.type ?? "line",
        points: output.chart.points,
      });
    }
    if (output.diagram?.mermaid) {
      visuals.push({
        type: "diagram",
        title: output.diagram.title ?? "Diagram",
        mermaid: output.diagram.mermaid,
      });
    }
  }
  return visuals;
}

/** Renders chart/diagram visuals as markdown lines (tables + mermaid fences). Shared by chat reports and playbook reports. */
export function renderVisualsMarkdown(visuals: ReportVisual[]): string[] {
  const lines: string[] = ["## Visuals", ""];
  for (const visual of visuals) {
    if (visual.type === "diagram") {
      lines.push(`### ${visual.title}`, "", "```mermaid", visual.mermaid, "```", "");
    } else {
      lines.push(`### ${visual.title}`, "", "| Bucket | Value |", "| --- | --- |");
      for (const point of visual.points.slice(0, 60)) {
        lines.push(`| ${point.label} | ${point.value} |`);
      }
      lines.push("");
    }
  }
  return lines;
}

/** Builds a shareable markdown report out of the analyst's answers and evidence. */
export function buildReportMarkdown(options: {
  title: string;
  datasetName: string | null;
  model: string;
  messages: ChatMessage[];
}) {
  const { title, datasetName, model, messages } = options;
  const questions = messages
    .filter((message) => message.role === "user")
    .map((message) => message.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join(" "))
    .filter(Boolean);

  const answers = messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join("\n"))
    .filter((text) => text.trim());

  const collected = outputs(messages);
  const flows = new Map<number, NonNullable<ToolOutput["flows"]>[number]>();
  const logs = new Map<number, NonNullable<ToolOutput["logs"]>[number]>();
  const packets = new Map<number, NonNullable<ToolOutput["packets"]>[number]>();
  for (const output of collected) {
    for (const flow of output.flows ?? []) flows.set(flow.id, flow);
    for (const log of output.logs ?? []) logs.set(log.id, log);
    for (const packet of output.packets ?? []) packets.set(packet.id, packet);
  }

  const lines: string[] = [
    `# ${title}`,
    "",
    `- **Dataset:** ${datasetName ?? "not bound"}`,
    `- **Model:** ${model}`,
    `- **Generated:** ${new Date().toISOString()}`,
    "",
    "## Questions asked",
    ...(questions.length ? questions.map((question) => `- ${question}`) : ["- (none)"]),
    "",
    "## Findings",
    ...(answers.length ? answers.map((answer) => `${answer}\n`) : ["_No analyst output yet._"]),
  ];

  const visuals = extractVisuals(messages);
  if (visuals.length) {
    lines.push(...renderVisualsMarkdown(visuals));
  }

  if (flows.size || logs.size || packets.size) {
    lines.push("## Evidence", "");
    if (flows.size) {
      lines.push("### Flows", "", "| id | time | source | destination | protocol | bytes |", "| --- | --- | --- | --- | --- | --- |");
      for (const flow of [...flows.values()].slice(0, 80)) {
        lines.push(
          `| ${flow.id} | ${flow.ts ?? "-"} | ${flow.src ?? "-"} | ${flow.dst ?? "-"} | ${flow.protocol ?? "-"} | ${flow.bytes ?? 0} |`,
        );
      }
      lines.push("");
    }
    if (packets.size) {
      lines.push("### Packets", "", "| id | time | source | destination | protocol | length |", "| --- | --- | --- | --- | --- | --- |");
      for (const packet of [...packets.values()].slice(0, 80)) {
        lines.push(
          `| ${packet.id} | ${packet.ts ?? "-"} | ${packet.src ?? "-"} | ${packet.dst ?? "-"} | ${packet.protocol ?? "-"} | ${packet.length ?? 0} |`,
        );
      }
      lines.push("");
    }
    if (logs.size) {
      lines.push("### Logs", "", "| id | time | host | severity | message |", "| --- | --- | --- | --- | --- |");
      for (const log of [...logs.values()].slice(0, 80)) {
        lines.push(
          `| ${log.id} | ${log.ts ?? "-"} | ${log.host ?? "-"} | ${log.severity ?? "-"} | ${log.message.replace(/\|/g, "/").slice(0, 160)} |`,
        );
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function downloadMarkdown(filename: string, markdown: string) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
