/** Structured stdout logger: one JSON line per event, easy to ship/grep. */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEvent = {
  ts: string;
  level: LogLevel;
  kind: string;
  message: string;
  [key: string]: unknown;
};

const recentEvents: LogEvent[] = [];
const MAX_RECENT = 200;

function emit(level: LogLevel, kind: string, message: string, extra?: Record<string, unknown>) {
  const event: LogEvent = { ts: new Date().toISOString(), level, kind, message, ...extra };
  recentEvents.push(event);
  if (recentEvents.length > MAX_RECENT) recentEvents.shift();
  const line = JSON.stringify(event);
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const log = {
  debug: (kind: string, message: string, extra?: Record<string, unknown>) =>
    emit("debug", kind, message, extra),
  info: (kind: string, message: string, extra?: Record<string, unknown>) =>
    emit("info", kind, message, extra),
  warn: (kind: string, message: string, extra?: Record<string, unknown>) =>
    emit("warn", kind, message, extra),
  error: (kind: string, message: string, extra?: Record<string, unknown>) =>
    emit("error", kind, message, extra),
};

/** Recent events for heartbeat payloads (drained on read). */
export function drainRecentEvents(): { level: string; kind: string; message: string }[] {
  const out = recentEvents.map((e) => ({ level: e.level, kind: e.kind, message: e.message }));
  recentEvents.length = 0;
  return out;
}
