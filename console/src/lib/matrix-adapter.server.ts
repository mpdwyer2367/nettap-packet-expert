/**
 * MATRIX adapter contract. An adapter turns a vendor fabric (or the built-in
 * simulator) into the normalized `MatrixSnapshot` contract. Adapters are
 * strictly read-only: they must never issue write/config-changing requests.
 */
import type { MatrixConnectionSummary, MatrixPortCounterSample, MatrixSnapshot } from "./matrix-types";

export type MatrixAdapter = {
  describe(): { mode: "simulator" | "live"; base_url: string | null };
  /** Full inventory + policy + alarm + latest-counters pull for one poll cycle. */
  fetchSnapshot(): Promise<MatrixSnapshot>;
  /** Optional finer-grained counter refresh (falls back to snapshot counters if unused). */
  fetchPortCounters(): Promise<MatrixPortCounterSample[]>;
};

class SimulatorAdapter implements MatrixAdapter {
  constructor(private connectionId: string) {}

  describe() {
    return { mode: "simulator" as const, base_url: null };
  }

  async fetchSnapshot(): Promise<MatrixSnapshot> {
    const { buildSimulatedSnapshot } = await import("./matrix-simulator.server");
    return buildSimulatedSnapshot(this.connectionId);
  }

  async fetchPortCounters(): Promise<MatrixPortCounterSample[]> {
    const { buildSimulatedTopology, buildSimulatedCounters } = await import("./matrix-simulator.server");
    const topo = buildSimulatedTopology(this.connectionId);
    return buildSimulatedCounters(this.connectionId, topo.ports);
  }
}

/**
 * Live HTTP adapter. Performs authenticated GET-only requests against
 * `base_url`. The bearer token is read from `process.env[secret_name]` (a
 * Supabase secret projected into the function's environment) and never
 * logged or persisted. `verify_tls: false` is not supported here — Node's
 * global fetch always verifies TLS; disabling verification would require
 * per-request agent overrides that are intentionally not wired up so an
 * operator cannot silently downgrade to an insecure transport. If a fabric
 * only offers self-signed certs, terminate TLS at a trusted proxy instead.
 */
class LiveHttpAdapter implements MatrixAdapter {
  constructor(
    private connection: MatrixConnectionSummary,
    private token: string | null,
  ) {}

  describe() {
    return { mode: "live" as const, base_url: this.connection.base_url };
  }

  private async getJson(path: string): Promise<unknown> {
    if (!this.connection.base_url) throw new Error("MATRIX connection has no base_url configured.");
    const url = new URL(path, this.connection.base_url).toString();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    let response: Response;
    try {
      response = await fetch(url, { method: "GET", headers });
    } catch (err) {
      throw new Error(`MATRIX fabric unreachable at ${url}: ${(err as Error).message}`);
    }
    if (!response.ok) {
      throw new Error(`MATRIX fabric returned ${response.status} for ${url}`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error(`MATRIX fabric returned non-JSON response for ${url}`);
    }
  }

  async fetchSnapshot(): Promise<MatrixSnapshot> {
    const [devicesRaw, portsRaw, linksRaw, alarmsRaw, policiesRaw, revisionRaw] = await Promise.all([
      this.getJson("/api/v1/devices").catch(() => []),
      this.getJson("/api/v1/ports").catch(() => []),
      this.getJson("/api/v1/links").catch(() => []),
      this.getJson("/api/v1/alarms").catch(() => []),
      this.getJson("/api/v1/policies").catch(() => []),
      this.getJson("/api/v1/config/revision").catch(() => null),
    ]);

    const devices = mapDevices(devicesRaw, this.connection.id);
    const ports = mapPorts(portsRaw, this.connection.id);
    const links = mapLinks(linksRaw, this.connection.id);
    const alarms = mapAlarms(alarmsRaw, this.connection.id);
    const policies = mapPolicies(policiesRaw, this.connection.id);
    const configRevision = mapRevision(revisionRaw, this.connection.id);
    const counters = await this.fetchPortCounters().catch(() => []);

    return { devices, ports, links, alarms, policies, configRevision, counters };
  }

  async fetchPortCounters(): Promise<MatrixPortCounterSample[]> {
    const raw = await this.getJson("/api/v1/port-counters").catch(() => []);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((row) => {
        const r = row as Record<string, unknown>;
        const portId = String(r["port_id"] ?? r["id"] ?? "");
        if (!portId) return null;
        return {
          port_id: portId,
          bucket_ts: String(r["bucket_ts"] ?? r["ts"] ?? new Date().toISOString()),
          rx_bytes: Number(r["rx_bytes"] ?? 0),
          tx_bytes: Number(r["tx_bytes"] ?? 0),
          rx_packets: Number(r["rx_packets"] ?? 0),
          tx_packets: Number(r["tx_packets"] ?? 0),
          errors: Number(r["errors"] ?? 0),
          discards: Number(r["discards"] ?? 0),
          crc_errors: Number(r["crc_errors"] ?? 0),
          utilization_pct: r["utilization_pct"] === null || r["utilization_pct"] === undefined ? null : Number(r["utilization_pct"]),
        } satisfies MatrixPortCounterSample;
      })
      .filter((x): x is MatrixPortCounterSample => x !== null);
  }
}

function mapDevices(raw: unknown, connectionId: string) {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r["id"] ?? r["device_key"] ?? crypto.randomUUID()),
      connection_id: connectionId,
      device_key: String(r["device_key"] ?? r["id"] ?? ""),
      name: String(r["name"] ?? r["device_key"] ?? "unknown"),
      site: r["site"] ? String(r["site"]) : null,
      role: String(r["role"] ?? "unknown"),
      model: r["model"] ? String(r["model"]) : null,
      serial: r["serial"] ? String(r["serial"]) : null,
      os_version: r["os_version"] ? String(r["os_version"]) : null,
      mgmt_ip: r["mgmt_ip"] ? String(r["mgmt_ip"]) : null,
      health_status: String(r["health_status"] ?? "unknown"),
      health: (r["health"] as Record<string, unknown>) ?? {},
      p4_state: (r["p4_state"] as Record<string, unknown>) ?? {},
      last_seen_at: String(r["last_seen_at"] ?? new Date().toISOString()),
    };
  });
}

function mapPorts(raw: unknown, connectionId: string) {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r["id"] ?? r["port_key"] ?? crypto.randomUUID()),
      connection_id: connectionId,
      device_id: String(r["device_id"] ?? ""),
      port_key: String(r["port_key"] ?? r["id"] ?? ""),
      name: String(r["name"] ?? r["port_key"] ?? "unknown"),
      kind: String(r["kind"] ?? "unknown"),
      speed_bps: r["speed_bps"] ? Number(r["speed_bps"]) : null,
      admin_state: String(r["admin_state"] ?? "unknown"),
      oper_state: String(r["oper_state"] ?? "unknown"),
      media: r["media"] ? String(r["media"]) : null,
      description: r["description"] ? String(r["description"]) : null,
      extra: (r["extra"] as Record<string, unknown>) ?? {},
    };
  });
}

function mapLinks(raw: unknown, connectionId: string) {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r["id"] ?? r["link_key"] ?? crypto.randomUUID()),
      connection_id: connectionId,
      src_port_id: r["src_port_id"] ? String(r["src_port_id"]) : null,
      dst_port_id: r["dst_port_id"] ? String(r["dst_port_id"]) : null,
      link_key: String(r["link_key"] ?? r["id"] ?? ""),
      kind: String(r["kind"] ?? "unknown"),
      status: String(r["status"] ?? "unknown"),
      extra: (r["extra"] as Record<string, unknown>) ?? {},
    };
  });
}

function mapAlarms(raw: unknown, connectionId: string) {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r["id"] ?? r["alarm_key"] ?? crypto.randomUUID()),
      connection_id: connectionId,
      alarm_key: String(r["alarm_key"] ?? r["id"] ?? ""),
      device_key: r["device_key"] ? String(r["device_key"]) : null,
      port_key: r["port_key"] ? String(r["port_key"]) : null,
      severity: String(r["severity"] ?? "info"),
      state: String(r["state"] ?? "active"),
      category: r["category"] ? String(r["category"]) : null,
      message: String(r["message"] ?? ""),
      raised_at: String(r["raised_at"] ?? new Date().toISOString()),
      cleared_at: r["cleared_at"] ? String(r["cleared_at"]) : null,
      extra: (r["extra"] as Record<string, unknown>) ?? {},
    };
  });
}

function mapPolicies(raw: unknown, connectionId: string) {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r["id"] ?? r["policy_key"] ?? crypto.randomUUID()),
      connection_id: connectionId,
      policy_key: String(r["policy_key"] ?? r["id"] ?? ""),
      name: String(r["name"] ?? "unnamed policy"),
      device_key: r["device_key"] ? String(r["device_key"]) : null,
      enabled: Boolean(r["enabled"] ?? true),
      priority: Number(r["priority"] ?? 0),
      ingress_ports: Array.isArray(r["ingress_ports"]) ? r["ingress_ports"].map(String) : [],
      egress_ports: Array.isArray(r["egress_ports"]) ? r["egress_ports"].map(String) : [],
      actions: (r["actions"] as Record<string, unknown>) ?? {},
      match_rules: (r["match_rules"] as Record<string, unknown>) ?? {},
      revision: Number(r["revision"] ?? 1),
    };
  });
}

function mapRevision(raw: unknown, connectionId: string) {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    id: String(r["id"] ?? crypto.randomUUID()),
    connection_id: connectionId,
    revision: Number(r["revision"] ?? 1),
    author: r["author"] ? String(r["author"]) : null,
    summary: r["summary"] ? String(r["summary"]) : null,
    snapshot: (r["snapshot"] as Record<string, unknown>) ?? (r as Record<string, unknown>),
    captured_at: String(r["captured_at"] ?? new Date().toISOString()),
  };
}

export function createMatrixAdapter(
  connection: MatrixConnectionSummary,
  secret?: string | null,
): MatrixAdapter {
  if (connection.mode === "live") {
    const token = secret ?? (connection.secret_name ? process.env[connection.secret_name] ?? null : null);
    return new LiveHttpAdapter(connection, token);
  }
  return new SimulatorAdapter(connection.id);
}
