import { createUserSupabaseClient } from "@/lib/supabase-user.server";

const DEFAULT_OLLAMA_URL = "http://ollama:11434";
const DEFAULT_MODEL = "nettap-ai:0.4.0-rc.1";
const MAX_CHAT_BYTES = 1_048_576;
const MAX_MESSAGES = 80;
const MAX_TOOLS = 128;
const MAX_CONCURRENT_PER_USER = 2;
const MAX_REQUESTS_PER_MINUTE = 90;

type RateState = { windowStartedAt: number; requests: number; concurrent: number };
const rateStates = new Map<string, RateState>();

export function managedModel() {
  return process.env["NETTAP_AI_MODEL"]?.trim() || DEFAULT_MODEL;
}

export function managedOllamaUrl() {
  const raw = process.env["OLLAMA_BASE_URL"]?.trim() || DEFAULT_OLLAMA_URL;
  const url = new URL(raw);
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    (url.pathname && url.pathname !== "/") ||
    url.search ||
    url.hash
  ) {
    throw new Error("OLLAMA_BASE_URL must be an HTTP(S) origin without credentials or a path query.");
  }
  return url.toString().replace(/\/$/, "");
}

export async function requireConsoleUser(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || token.length > 8192) throw new Response("Unauthorized", { status: 401 });

  const supabase = createUserSupabaseClient(token);
  const { data, error } = await supabase.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string" || !userId) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return userId;
}

export function acquireOllamaSlot(userId: string) {
  const now = Date.now();
  let state = rateStates.get(userId);
  if (!state || now - state.windowStartedAt >= 60_000) {
    state = { windowStartedAt: now, requests: 0, concurrent: 0 };
    rateStates.set(userId, state);
  }
  if (state.requests >= MAX_REQUESTS_PER_MINUTE) {
    throw new Response("Model request limit exceeded", {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }
  if (state.concurrent >= MAX_CONCURRENT_PER_USER) {
    throw new Response("Too many concurrent model requests", {
      status: 429,
      headers: { "Retry-After": "2" },
    });
  }
  state.requests += 1;
  state.concurrent += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state!.concurrent = Math.max(0, state!.concurrent - 1);
  };
}

export async function readManagedChatBody(request: Request) {
  const length = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(length) && length > MAX_CHAT_BYTES) {
    throw new Response("Request body too large", { status: 413 });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_CHAT_BYTES) {
    throw new Response("Request body too large", { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Response("Invalid JSON", { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    throw new Response(`messages must contain 1-${MAX_MESSAGES} items`, { status: 400 });
  }
  if (body.tools != null && (!Array.isArray(body.tools) || body.tools.length > MAX_TOOLS)) {
    throw new Response(`tools must contain at most ${MAX_TOOLS} items`, { status: 400 });
  }

  return {
    ...body,
    model: managedModel(),
    stream: true,
    options: {
      ...(typeof body.options === "object" && body.options ? body.options : {}),
      temperature: 0.2,
    },
  };
}

export function privateHeaders(extra: HeadersInit = {}) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'",
    "X-Content-Type-Options": "nosniff",
  });
  new Headers(extra).forEach((value, name) => headers.set(name, value));
  return headers;
}
