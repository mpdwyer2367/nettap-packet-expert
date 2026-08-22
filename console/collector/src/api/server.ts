/**
 * Small localhost-bound HTTP API the console proxies drill-down queries
 * through: health, status, capacity, interfaces, and a manual import
 * trigger. Not exposed to the internet — bound to api.bind_address (default
 * 127.0.0.1) from collector.json.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { log } from "../logger.js";
import type { CapacityRuntime } from "../capacity.js";
import type { ReportedInterface } from "../contract.js";

export type HistoryApi = {
  coverage: () => Promise<unknown>;
  timeline: (minutes: number, limit: number) => Promise<unknown>;
  talkers: (hours: number, limit: number) => Promise<unknown>;
  services: (hours: number, limit: number) => Promise<unknown>;
  retentionRuns: (limit: number) => Promise<unknown>;
  runRetention: () => Promise<unknown>;
};

export type ApiDeps = {
  version: string;
  startedAt: number;
  getCapacity: () => CapacityRuntime;
  getInterfaces: () => ReportedInterface[];
  getStatus: () => Record<string, unknown>;
  triggerImport: () => void;
  history?: HistoryApi;
};

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

export class LocalApiServer {
  private server: Server | null = null;

  constructor(private deps: ApiDeps) {}

  start(port: number, bindAddress: string): void {
    this.server = createServer((req, res) => this.handle(req, res));
    this.server.listen(port, bindAddress, () => {
      log.info("api", `Local API listening on ${bindAddress}:${port}`);
    });
    this.server.on("error", (err) => {
      log.error("api", "Local API server error", { error: String(err) });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const num = (key: string, fallback: number): number => {
      const raw = Number(url.searchParams.get(key));
      return Number.isFinite(raw) && raw > 0 ? raw : fallback;
    };
    try {
      if (req.method === "GET" && path === "/health") {
        return json(res, 200, { ok: true, uptime_seconds: Math.round((Date.now() - this.deps.startedAt) / 1000) });
      }
      if (req.method === "GET" && path === "/status") {
        return json(res, 200, { version: this.deps.version, ...this.deps.getStatus() });
      }
      if (req.method === "GET" && path === "/capacity") {
        return json(res, 200, this.deps.getCapacity());
      }
      if (req.method === "GET" && path === "/interfaces") {
        return json(res, 200, this.deps.getInterfaces());
      }
      if (req.method === "POST" && path === "/import/trigger") {
        this.deps.triggerImport();
        return json(res, 202, { ok: true });
      }

      // Read-only history surfaces the console/LLM queries.
      const history = this.deps.history;
      if (history && path.startsWith("/history")) {
        const respond = (p: Promise<unknown>) =>
          void p.then((body) => json(res, 200, body)).catch((err) => {
            log.error("api", "history query failed", { path, error: String(err) });
            json(res, 500, { error: "History query failed" });
          });
        if (req.method === "GET" && path === "/history/coverage") return respond(history.coverage());
        if (req.method === "GET" && path === "/history/timeline")
          return respond(history.timeline(num("minutes", 60), num("limit", 500)));
        if (req.method === "GET" && path === "/history/talkers")
          return respond(history.talkers(num("hours", 24), num("limit", 25)));
        if (req.method === "GET" && path === "/history/services")
          return respond(history.services(num("hours", 24), num("limit", 25)));
        if (req.method === "GET" && path === "/history/retention")
          return respond(history.retentionRuns(num("limit", 20)));
        if (req.method === "POST" && path === "/history/retention/run")
          return respond(history.runRetention());
      }
      json(res, 404, { error: "Not found" });
    } catch (err) {
      log.error("api", "Request handler failed", { path, error: err instanceof Error ? err.message : String(err) });
      json(res, 500, { error: "Internal error" });
    }
  }
}
