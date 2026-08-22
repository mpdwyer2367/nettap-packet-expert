import { runTelemetryTool } from "@/lib/telemetry.functions";
import { NETTAP_SYSTEM_PROMPT, TELEMETRY_TOOLS } from "@/lib/telemetry-tool-schemas";
import { supabase } from "@/integrations/supabase/client";

/** Where the user's local Ollama server lives, and which model to drive. */
export type OllamaSettings = {
  baseUrl: string;
  model: string;
};

export type OllamaConnectionStatus = {
  ok: boolean;
  models: string[];
  modelAvailable: boolean;
  message: string;
};

export const DEFAULT_OLLAMA_SETTINGS: OllamaSettings = {
  baseUrl: "/api/nettap/ollama",
  model: "nettap-ai:0.4.0-rc.1",
};

export function loadOllamaSettings(): OllamaSettings {
  return DEFAULT_OLLAMA_SETTINGS;
}

async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has expired. Sign in again.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const normalizedUrl = normalizeOllamaUrl(baseUrl);
  const response = await authorizedFetch(`${normalizedUrl}/tags`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Ollama responded ${response.status}`);
  const body = (await response.json()) as { models?: { name?: string }[] };
  return (body.models ?? []).map((model) => model.name ?? "").filter(Boolean);
}


export function normalizeOllamaUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/$/, "");
}

async function showOllamaModel(baseUrl: string, model: string) {
  const response = await authorizedFetch(`${baseUrl}/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model }),
  });
  if (!response.ok) throw new Error(`Ollama responded ${response.status}`);
  return (await response.json()) as {
    details?: unknown;
    modelfile?: string;
    parameters?: string;
    template?: string;
  };
}

export async function testOllamaConnection(
  settings: OllamaSettings,
  options: { verifyLoad?: boolean } = {},
): Promise<OllamaConnectionStatus> {
  const baseUrl = normalizeOllamaUrl(settings.baseUrl);
  if (baseUrl !== DEFAULT_OLLAMA_SETTINGS.baseUrl || settings.model !== DEFAULT_OLLAMA_SETTINGS.model) {
    return {
      ok: false,
      models: [],
      modelAvailable: false,
      message: "The appliance model endpoint is managed and cannot be overridden.",
    };
  }

  try {
    const models = await listOllamaModels(baseUrl);
    const requested = settings.model.split(":")[0];
    const modelAvailable = models.some((model) => model.split(":")[0] === requested);

    if (!modelAvailable) {
      return {
        ok: false,
        models,
        modelAvailable: false,
        message: `Ollama is reachable, but ${settings.model} is not installed. Pull it with "ollama pull ${settings.model}".`,
      };
    }

    if (options.verifyLoad) {
      try {
        const info = await showOllamaModel(baseUrl, settings.model);
        return {
          ok: true,
          models,
          modelAvailable: true,
          message: `${settings.model} is reachable and ready to load (template: ${info.template ? "yes" : "no"}, parameters: ${info.parameters ? "yes" : "no"}).`,
        };
      } catch (error) {
        return {
          ok: false,
          models,
          modelAvailable: true,
          message: `Ollama is reachable and ${settings.model} is listed, but the model could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    return {
      ok: true,
      models,
      modelAvailable: true,
      message: `${settings.model} is connected and ready.`,
    };
  } catch (error) {
    return {
      ok: false,
      models: [],
      modelAvailable: false,
      message: error instanceof Error
        ? `Could not connect to the managed NetTAP model: ${error.message}`
        : "Could not connect to the managed NetTAP model.",
    };
  }
}


/* ------------------------------------------------------------------ */
/* Chat parts (mirrors the AI SDK UIMessage shape the UI already renders) */
/* ------------------------------------------------------------------ */

export type ChatTextPart = { type: "text"; text: string };
export type ChatToolPart = {
  type: `tool-${string}`;
  state: "input-available" | "output-available" | "output-error";
  input?: unknown;
  output?: unknown;
  errorText?: string;
};
/** Which engine produced an assistant turn. Persisted with the message parts. */
export type ChatEngine = "managed" | "local" | "cloud";
export type ChatEnginePart = { type: "engine"; engine: ChatEngine; model?: string };
export type ChatPart = ChatTextPart | ChatToolPart | ChatEnginePart;

export function readMessageEngine(parts: ChatPart[]) {
  return parts.find((part): part is ChatEnginePart => part.type === "engine") ?? null;
}

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  parts: ChatPart[];
};

type OllamaToolCall = {
  function?: { name?: string; arguments?: unknown };
};

type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
};

function partsToText(parts: ChatPart[]) {
  return parts
    .filter((part): part is ChatTextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function historyToOllama(messages: ChatMessage[]): OllamaMessage[] {
  const out: OllamaMessage[] = [];
  for (const message of messages) {
    const text = partsToText(message.parts);
    const toolParts = message.parts.filter((p): p is ChatToolPart => p.type.startsWith("tool-"));

    if (message.role === "user") {
      out.push({ role: "user", content: text || "(empty)" });
    } else {
      // Assistant message might have text and/or tool calls
      const toolCalls: OllamaToolCall[] = toolParts.map((p) => ({
        function: { name: p.type.replace("tool-", ""), arguments: p.input },
      }));
      out.push({
        role: "assistant",
        content: text,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });

      // For each tool call, we need a "tool" role message with the output
      for (const p of toolParts) {
        if (p.state === "output-available" || p.state === "output-error") {
          out.push({
            role: "tool",
            tool_name: p.type.replace("tool-", ""),
            content: p.state === "output-available" 
              ? JSON.stringify(p.output).slice(0, 24000) 
              : `Error: ${p.errorText}`,
          });
        }
      }
    }
  }
  return out;
}

function friendlyConnectionError(baseUrl: string) {
  return new Error(`Could not reach the appliance-managed Ollama endpoint at ${baseUrl}.`);
}

async function* streamNdjson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        yield JSON.parse(trimmed) as {
          message?: { content?: string; tool_calls?: OllamaToolCall[] };
          done?: boolean;
          error?: string;
        };
      } catch {
        /* ignore partial/garbage lines */
      }
    }
  }
  const finalLine = buffer.trim();
  if (finalLine) {
    try {
      yield JSON.parse(finalLine) as {
        message?: { content?: string; tool_calls?: OllamaToolCall[] };
        done?: boolean;
        error?: string;
      };
    } catch {
      /* ignore a truncated terminal line */
    }
  }
}

const MAX_STEPS = 12;

/**
 * Drives the user's locally running nettap-packet-expert Ollama model.
 *
 * The model call happens in the browser (Ollama is on the user's machine), while
 * every telemetry tool call is executed server-side against the user's dataset.
 */
export async function runOllamaInvestigation(options: {
  settings: OllamaSettings;
  datasetId: string;
  history: ChatMessage[];
  signal?: AbortSignal;
  onParts: (parts: ChatPart[]) => void;
}) {
  const { settings, datasetId, history, signal, onParts } = options;
  const baseUrl = normalizeOllamaUrl(settings.baseUrl);

  const connection = await testOllamaConnection(settings);
  if (!connection.ok) throw new Error(connection.message);

  const conversation: OllamaMessage[] = [
    { role: "system", content: NETTAP_SYSTEM_PROMPT },
    ...historyToOllama(history),
  ];

  const parts: ChatPart[] = [];
  const emit = () => onParts([...parts]);

  for (let step = 0; step < MAX_STEPS; step += 1) {
    let response: Response;
    try {
      response = await authorizedFetch(`${baseUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: signal ?? null,
        body: JSON.stringify({
          model: settings.model,
          messages: conversation,
          tools: TELEMETRY_TOOLS,
          stream: true,
          options: { temperature: 0.2 },
        }),
      });
    } catch {
      throw friendlyConnectionError(baseUrl);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Ollama error ${response.status}: ${detail.slice(0, 400)}`);
    }

    let assistantText = "";
    const toolCalls: OllamaToolCall[] = [];
    let textPart: ChatTextPart | null = null;

    for await (const chunk of streamNdjson(response)) {
      if (chunk.error) throw new Error(`Ollama error: ${chunk.error}`);
      const delta = chunk.message?.content ?? "";
      if (delta) {
        assistantText += delta;
        if (!textPart) {
          textPart = { type: "text", text: "" };
          parts.push(textPart);
        }
        textPart.text += delta;
        emit();
      }
      for (const call of chunk.message?.tool_calls ?? []) toolCalls.push(call);
    }

    conversation.push({
      role: "assistant",
      content: assistantText,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });

    if (toolCalls.length === 0) {
      emit();
      return parts;
    }

    for (const call of toolCalls) {
      const name = call.function?.name ?? "unknown";
      const rawArgs = call.function?.arguments;
      let args: Record<string, unknown> = {};
      if (typeof rawArgs === "string") {
        try {
          args = JSON.parse(rawArgs) as Record<string, unknown>;
        } catch {
          args = {};
        }
      } else if (rawArgs && typeof rawArgs === "object") {
        args = rawArgs as Record<string, unknown>;
      }

      const toolPart: ChatToolPart = {
        type: `tool-${name}`,
        state: "input-available",
        input: args,
      };
      parts.push(toolPart);
      textPart = null;
      emit();

      try {
        const { result } = await runTelemetryTool({ data: { datasetId, tool: name, args } });
        const parsed = JSON.parse(result) as unknown;
        toolPart.state = "output-available";
        toolPart.output = parsed;
        conversation.push({
          role: "tool",
          tool_name: name,
          content: result.slice(0, 24000),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolPart.state = "output-error";
        toolPart.errorText = message;
        conversation.push({ role: "tool", tool_name: name, content: `Error: ${message}` });
      }
      emit();
    }
  }

  parts.push({
    type: "text",
    text: "_Stopped after the maximum number of tool steps — try a narrower question._",
  });
  emit();
  return parts;
}
