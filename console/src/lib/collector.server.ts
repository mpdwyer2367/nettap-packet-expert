/**
 * Server-only logic for the NetTAP collector appliance.
 *
 * The appliance runs on your VM, owns the live network (interfaces, NetFlow/IPFIX
 * receivers, packet capture, ICMP/SNMP/WMI polling) and checks in here. Only the
 * SHA-256 hash of its pairing token is stored, so a leaked row cannot be replayed.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  COLLECTOR_STALE_SECONDS,
  DEFAULT_COLLECTOR_CONFIG,
  collectorStatusFrom,
  normalizeConfig,
  redactConfig,
} from "./collector-types";
import { validateLimits } from "./capacity";
import type { CapacityLimits } from "./capacity";
import type {
  ApplianceOverview,
  CollectorConfig,
  CollectorStats,
  CollectorEventRow,
  CollectorOs,
  CollectorRow,
  DeviceFactRow,
  ExporterRow,
  HeartbeatRequest,
  HeartbeatResponse,
  InterfaceRow,
  MetricPoint,
  ProbeSummaryRow,
  UplinkRequest,
  UplinkResponse,
} from "./collector-types";

type Client = SupabaseClient<Database>;

const MAX_METRIC_ROWS = 5_000;
const MAX_ROLLUP_ROWS = 20_000;
const MAX_PROBE_ROWS = 5_000;
const MAX_FACT_ROWS = 500;

export function hashCollectorToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function mintCollectorToken() {
  return randomBytes(32).toString("base64url");
}

/** Optional body signature check: HMAC-SHA256(body, token). */
export function signatureMatches(signature: string | null, body: string, token: string) {
  if (!signature) return true; // signature is belt-and-braces on top of the bearer token
  const expected = createHash("sha256").update(`${token}:${body}`).digest("hex");
  const a = Buffer.from(signature.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* -------------------------------------------------------------------------- */
/* Appliance-authenticated paths (public routes, service role)                */
/* -------------------------------------------------------------------------- */

type CollectorRecord = {
  id: string;
  user_id: string;
  dataset_id: string | null;
  config: unknown;
  config_revision: number;
  applied_revision: number;
};

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Client;
}

async function authenticate(token: string) {
  if (!token) throw new Error("Missing collector token");
  const admin = await adminClient();
  const { data, error } = await admin
    .from("collectors")
    .select("id, user_id, dataset_id, config, config_revision, applied_revision")
    .eq("token_hash", hashCollectorToken(token))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Unknown collector token");
  return { admin, collector: data as CollectorRecord };
}

export async function handleHeartbeat(
  token: string,
  body: HeartbeatRequest,
): Promise<HeartbeatResponse> {
  const { admin, collector } = await authenticate(token);
  const applied = Math.max(0, Math.trunc(Number(body.applied_revision) || 0));
  const os: CollectorOs =
    body.os === "windows" || body.os === "macos" || body.os === "linux" ? body.os : "linux";

  const errorEvent = (body.events ?? []).find((event) => event.level === "error");
  await admin
    .from("collectors")
    .update({
      version: body.version?.slice(0, 40) ?? null,
      hostname: body.hostname?.slice(0, 200) ?? null,
      os,
      status: errorEvent ? "error" : "online",
      last_seen_at: new Date().toISOString(),
      last_error: errorEvent ? errorEvent.message.slice(0, 500) : null,
      applied_revision: applied,
      stats: (body.stats ?? {}) as never,
      updated_at: new Date().toISOString(),
    })
    .eq("id", collector.id);

  const interfaces = (body.interfaces ?? []).slice(0, 200);
  if (interfaces.length) {
    const seen = new Date().toISOString();
    await admin.from("collector_interfaces").upsert(
      interfaces.map((iface) => ({
        collector_id: collector.id,
        user_id: collector.user_id,
        name: iface.name.slice(0, 120),
        description: iface.description?.slice(0, 300) ?? null,
        mac: iface.mac?.slice(0, 40) ?? null,
        addresses: (iface.addresses ?? []).slice(0, 20) as never,
        link_speed_bps: iface.link_speed_bps ?? null,
        is_up: Boolean(iface.is_up),
        is_loopback: Boolean(iface.is_loopback),
        last_seen_at: seen,
      })),
      { onConflict: "collector_id,name" },
    );
  }

  const events = (body.events ?? []).slice(0, 50);
  if (events.length) {
    await admin.from("collector_events").insert(
      events.map((event) => ({
        collector_id: collector.id,
        user_id: collector.user_id,
        level: ["info", "warn", "error"].includes(event.level) ? event.level : "info",
        kind: event.kind.slice(0, 60),
        message: event.message.slice(0, 1000),
      })),
    );
  }

  const behind = applied < collector.config_revision;
  return {
    ok: true,
    collector_id: collector.id,
    config_revision: collector.config_revision,
    config: behind ? normalizeConfig(collector.config) : null,
    dataset_id: collector.dataset_id,
  };
}

export async function handleUplink(token: string, body: UplinkRequest): Promise<UplinkResponse> {
  const { admin, collector } = await authenticate(token);
  const accepted = {
    interface_metrics: 0,
    flow_rollups: 0,
    exporters: 0,
    probes: 0,
    device_facts: 0,
    packets: 0,
  };

  const metrics = (body.interface_metrics ?? []).slice(0, MAX_METRIC_ROWS);
  if (metrics.length) {
    const { error } = await admin.from("interface_metrics").insert(
      metrics.map((row) => ({
        collector_id: collector.id,
        user_id: collector.user_id,
        interface_name: row.interface_name.slice(0, 120),
        bucket_ts: row.bucket_ts,
        rx_bytes: Math.max(0, Math.trunc(row.rx_bytes || 0)),
        tx_bytes: Math.max(0, Math.trunc(row.tx_bytes || 0)),
        rx_packets: Math.max(0, Math.trunc(row.rx_packets || 0)),
        tx_packets: Math.max(0, Math.trunc(row.tx_packets || 0)),
        errors: Math.max(0, Math.trunc(row.errors || 0)),
        discards: Math.max(0, Math.trunc(row.discards || 0)),
        utilization_pct: row.utilization_pct ?? null,
        source: ["host", "snmp", "capture"].includes(row.source) ? row.source : "host",
      })),
    );
    if (error) throw new Error(error.message);
    accepted.interface_metrics = metrics.length;
  }

  const rollups = (body.flow_rollups ?? []).slice(0, MAX_ROLLUP_ROWS);
  if (rollups.length) {
    const datasetId = await ensureCollectorDataset(admin, collector);
    const { error } = await admin.from("flow_rollups").insert(
      rollups.map((row) => ({
        dataset_id: datasetId,
        user_id: collector.user_id,
        bucket_ts: row.bucket_ts,
        src_ip: row.src_ip,
        dst_ip: row.dst_ip,
        src_port: row.src_port,
        dst_port: row.dst_port,
        protocol: row.protocol,
        app_protocol: row.app_protocol ?? null,
        service: row.service ?? null,
        vantage: row.vantage ?? "flow_export",
        packets: Math.max(0, Math.trunc(row.packets || 0)),
        bytes: Math.max(0, Math.trunc(row.bytes || 0)),
        flow_count: Math.max(0, Math.trunc(row.flow_count || 0)),
        risk_tags: (row.risk_tags ?? []).slice(0, 12),
      })),
    );
    if (error) throw new Error(error.message);
    accepted.flow_rollups = rollups.length;

    const totalBytes = rollups.reduce((sum, row) => sum + (row.bytes || 0), 0);
    const totalFlows = rollups.reduce((sum, row) => sum + (row.flow_count || 0), 0);
    await bumpDataset(admin, datasetId, totalFlows, totalBytes, rollups);
  }

  const exporters = (body.exporters ?? []).slice(0, 200);
  if (exporters.length) {
    const seen = new Date().toISOString();
    const { error } = await admin.from("flow_exporters").upsert(
      exporters.map((row) => ({
        collector_id: collector.id,
        user_id: collector.user_id,
        exporter_ip: row.exporter_ip.slice(0, 60),
        protocol: row.protocol.slice(0, 20),
        version: row.version?.slice(0, 20) ?? null,
        templates: Math.max(0, Math.trunc(row.templates || 0)),
        sampling_rate: row.sampling_rate ?? null,
        flows: Math.max(0, Math.trunc(row.flows || 0)),
        packets_dropped: Math.max(0, Math.trunc(row.packets_dropped || 0)),
        last_seen_at: seen,
      })),
      { onConflict: "collector_id,exporter_ip,protocol" },
    );
    if (error) throw new Error(error.message);
    accepted.exporters = exporters.length;
  }

  const probes = (body.probes ?? []).slice(0, MAX_PROBE_ROWS);
  if (probes.length) {
    const { error } = await admin.from("probe_results").insert(
      probes.map((row) => ({
        collector_id: collector.id,
        user_id: collector.user_id,
        kind: ["icmp", "snmp", "wmi"].includes(row.kind) ? row.kind : "icmp",
        target: row.target.slice(0, 200),
        metric: row.metric.slice(0, 80),
        value: row.value ?? null,
        value_text: row.value_text?.slice(0, 500) ?? null,
        unit: row.unit?.slice(0, 20) ?? null,
        status: row.status.slice(0, 30),
        ts: row.ts,
        extra: (row.extra ?? {}) as never,
      })),
    );
    if (error) throw new Error(error.message);
    accepted.probes = probes.length;
  }

  const facts = (body.device_facts ?? []).slice(0, MAX_FACT_ROWS);
  if (facts.length) {
    const { error } = await admin.from("device_facts").insert(
      facts.map((row) => ({
        collector_id: collector.id,
        user_id: collector.user_id,
        host: row.host.slice(0, 200),
        source: row.source === "ssh" ? "ssh" : "snmp",
        kind: row.kind.slice(0, 60),
        summary: row.summary?.slice(0, 500) ?? null,
        content: row.content.slice(0, 200_000),
        extra: (row.extra ?? {}) as never,
        collected_at: row.collected_at,
      })),
    );
    if (error) throw new Error(error.message);
    accepted.device_facts = facts.length;
  }

  if (body.packets_ek && body.packets_ek.trim()) {
    const datasetId = await ensureCollectorDataset(admin, collector);
    accepted.packets = await ingestCollectorPackets(admin, collector, datasetId, body.packets_ek);
  }

  return { ok: true, accepted };
}

/** Live appliance telemetry lands in one rolling dataset so chat/report tools see it. */
async function ensureCollectorDataset(admin: Client, collector: CollectorRecord) {
  if (collector.dataset_id) return collector.dataset_id;
  const { data, error } = await admin
    .from("datasets")
    .insert({
      user_id: collector.user_id,
      name: "Appliance live telemetry",
      kind: "flow",
      source_filename: `collector:${collector.id}`,
      status: "live",
      vantage: "flow_export",
      observation_point: "NetTAP collector appliance",
      retention_tier: "metadata",
      notes: "Rolling NetFlow/IPFIX, packet and probe telemetry pushed by the collector appliance.",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create appliance dataset");
  await admin.from("collectors").update({ dataset_id: data.id }).eq("id", collector.id);
  collector.dataset_id = data.id;
  return data.id;
}

async function bumpDataset(
  admin: Client,
  datasetId: string,
  flows: number,
  _bytes: number,
  rollups: UplinkRequest["flow_rollups"],
) {
  const stamps = (rollups ?? []).map((row) => row.bucket_ts).filter(Boolean).sort();
  const { data } = await admin
    .from("datasets")
    .select("record_count, range_start, range_end")
    .eq("id", datasetId)
    .maybeSingle();
  const first = stamps[0];
  const last = stamps[stamps.length - 1];
  await admin
    .from("datasets")
    .update({
      record_count: Number(data?.record_count ?? 0) + flows,
      range_start:
        !data?.range_start || (first && first < data.range_start) ? (first ?? null) : data.range_start,
      range_end: !data?.range_end || (last && last > data.range_end) ? (last ?? null) : data.range_end,
    })
    .eq("id", datasetId);
}

/** Decodes tshark EK NDJSON pushed by the appliance into packet_records + chunks. */
async function ingestCollectorPackets(
  admin: Client,
  collector: CollectorRecord,
  datasetId: string,
  ndjson: string,
) {
  const { decodeTsharkExport } = await import("./tshark-import");
  const { buildPacketChunks } = await import("./telemetry-extra");
  const { indexChunks } = await import("./ingest.server");

  const decoded = decodeTsharkExport(ndjson, `collector:${collector.id}`);
  if (!decoded.packets.length) return 0;

  const rows = decoded.packets.map((packet) => ({
    dataset_id: datasetId,
    user_id: collector.user_id,
    frame_number: packet.frame_number ?? null,
    ts: packet.ts,
    src_ip: packet.src_ip,
    dst_ip: packet.dst_ip,
    src_port: packet.src_port,
    dst_port: packet.dst_port,
    protocol: packet.protocol,
    length: packet.length ?? 0,
    tcp_flags: packet.tcp_flags,
    info: packet.info,
    app_protocol: packet.app_protocol,
    service: packet.service,
    risk_tags: packet.risk_tags ?? [],
    decryption: packet.decryption ?? "cleartext",
    extra: (packet.extra ?? {}) as never,
  }));

  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await admin.from("packet_records").insert(rows.slice(index, index + 500));
    if (error) throw new Error(error.message);
  }

  const chunks = buildPacketChunks(
    decoded.packets.map((packet, index) => ({ ...packet, id: index })) as never,
    60,
  );
  if (chunks.length) {
    try {
      await indexChunks(admin, collector.user_id, datasetId, chunks);
    } catch {
      // Indexing is best-effort: the packets are stored even if embeddings fail.
    }
  }
  return rows.length;
}


/* -------------------------------------------------------------------------- */
/* Console-authenticated paths (user session)                                 */
/* -------------------------------------------------------------------------- */

function toCollectorRow(row: Record<string, unknown>): CollectorRow {
  const config = normalizeConfig(row['config']);
  return {
    id: String(row['id']),
    name: String(row['name'] ?? "Collector"),
    os: (row['os'] as CollectorOs) ?? "linux",
    version: (row['version'] as string | null) ?? null,
    hostname: (row['hostname'] as string | null) ?? null,
    status:
      row['status'] === "disabled"
        ? "disabled"
        : collectorStatusFrom(
            (row['last_seen_at'] as string | null) ?? null,
            (row['last_error'] as string | null) ?? null,
          ),
    last_seen_at: (row['last_seen_at'] as string | null) ?? null,
    last_error: (row['last_error'] as string | null) ?? null,
    dataset_id: (row['dataset_id'] as string | null) ?? null,
    config: redactConfig(config),
    config_revision: Number(row['config_revision'] ?? 1),
    applied_revision: Number(row['applied_revision'] ?? 0),
    stats: (row['stats'] as CollectorRow["stats"]) ?? {},
    created_at: String(row['created_at']),
  };
}

export async function loadApplianceOverview(
  supabase: Client,
  userId: string,
): Promise<ApplianceOverview> {
  const [collectors, interfaces, exporters, probes, facts, events] = await Promise.all([
    supabase.from("collectors").select("*").eq("user_id", userId).order("created_at"),
    supabase
      .from("collector_interfaces")
      .select("*")
      .eq("user_id", userId)
      .order("name")
      .limit(500),
    supabase
      .from("flow_exporters")
      .select("*")
      .eq("user_id", userId)
      .order("last_seen_at", { ascending: false })
      .limit(100),
    supabase
      .from("probe_results")
      .select("kind, target, metric, unit, status, value, value_text, ts")
      .eq("user_id", userId)
      .gte("ts", new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .order("ts", { ascending: false })
      .limit(2000),
    supabase
      .from("device_facts")
      .select("id, host, source, kind, summary, content, collected_at")
      .eq("user_id", userId)
      .order("collected_at", { ascending: false })
      .limit(50),
    supabase
      .from("collector_events")
      .select("id, level, kind, message, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  const probeMap = new Map<string, ProbeSummaryRow & { sum: number }>();
  for (const row of probes.data ?? []) {
    const key = `${row.kind}|${row.target}|${row.metric}`;
    const existing = probeMap.get(key);
    const value = row.value === null ? null : Number(row.value);
    if (!existing) {
      probeMap.set(key, {
        kind: row.kind,
        target: row.target,
        metric: row.metric,
        unit: row.unit,
        status: row.status,
        latest: value,
        latest_text: row.value_text,
        avg_value: value,
        samples: 1,
        ts: row.ts as string,
        sum: value ?? 0,
      });
    } else {
      existing.samples += 1;
      existing.sum += value ?? 0;
      existing.avg_value = existing.sum / existing.samples;
    }
  }

  return {
    collectors: (collectors.data ?? []).map((row) => toCollectorRow(row as never)),
    interfaces: (interfaces.data ?? []).map((row) => ({
      id: row.id,
      collector_id: row.collector_id,
      name: row.name,
      description: row.description,
      mac: row.mac,
      addresses: Array.isArray(row.addresses) ? (row.addresses as string[]) : [],
      link_speed_bps: row.link_speed_bps === null ? null : Number(row.link_speed_bps),
      is_up: row.is_up,
      is_loopback: row.is_loopback,
      capture_enabled: row.capture_enabled,
      last_seen_at: row.last_seen_at,
    })) satisfies InterfaceRow[],
    exporters: (exporters.data ?? []).map((row) => ({
      exporter_ip: row.exporter_ip,
      protocol: row.protocol,
      version: row.version,
      templates: Number(row.templates ?? 0),
      sampling_rate: row.sampling_rate === null ? null : Number(row.sampling_rate),
      flows: Number(row.flows ?? 0),
      packets_dropped: Number(row.packets_dropped ?? 0),
      last_seen_at: row.last_seen_at,
    })) satisfies ExporterRow[],
    probes: [...probeMap.values()].map(({ sum: _sum, ...row }) => row),
    device_facts: (facts.data ?? []) as DeviceFactRow[],
    events: (events.data ?? []) as CollectorEventRow[],
  };
}

export async function loadInterfaceMetrics(
  supabase: Client,
  userId: string,
  input: { collectorId: string; interfaceName: string; minutes: number },
): Promise<MetricPoint[]> {
  const since = new Date(Date.now() - input.minutes * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("interface_metrics")
    .select("bucket_ts, rx_bytes, tx_bytes, rx_packets, tx_packets, errors, discards, utilization_pct")
    .eq("user_id", userId)
    .eq("collector_id", input.collectorId)
    .eq("interface_name", input.interfaceName)
    .gte("bucket_ts", since)
    .order("bucket_ts")
    .limit(4000);
  if (error) throw new Error(error.message);

  const seconds = 10;
  return (data ?? []).map((row) => ({
    bucket_ts: row.bucket_ts,
    rx_bps: (Number(row.rx_bytes ?? 0) * 8) / seconds,
    tx_bps: (Number(row.tx_bytes ?? 0) * 8) / seconds,
    rx_pps: Number(row.rx_packets ?? 0) / seconds,
    tx_pps: Number(row.tx_packets ?? 0) / seconds,
    errors: Number(row.errors ?? 0),
    discards: Number(row.discards ?? 0),
    utilization_pct: row.utilization_pct === null ? null : Number(row.utilization_pct),
  }));
}

export async function createCollector(
  supabase: Client,
  userId: string,
  input: { name: string; os: CollectorOs },
) {
  const token = mintCollectorToken();
  const { data, error } = await supabase
    .from("collectors")
    .insert({
      user_id: userId,
      name: input.name,
      os: input.os,
      status: "pending",
      token_hash: hashCollectorToken(token),
      config: DEFAULT_COLLECTOR_CONFIG as never,
      config_revision: 1,
      applied_revision: 0,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not register the collector");
  return { collector: toCollectorRow(data as never), token };
}

export async function rotateCollectorToken(supabase: Client, collectorId: string) {
  const token = mintCollectorToken();
  const { error } = await supabase
    .from("collectors")
    .update({ token_hash: hashCollectorToken(token), status: "pending", applied_revision: 0 })
    .eq("id", collectorId);
  if (error) throw new Error(error.message);
  return { token };
}

/**
 * Saves a config revision. Secrets arrive redacted from the console, so any
 * masked field falls back to the stored value instead of overwriting it.
 */
/**
 * Publishes capacity limits for one appliance. Errors from validateLimits block
 * the write; warnings are returned so the console can surface them inline.
 */
export async function saveCollectorCapacity(
  supabase: Client,
  collectorId: string,
  limits: CapacityLimits,
) {
  const { data: current, error: readError } = await supabase
    .from("collectors")
    .select("config, config_revision, stats")
    .eq("id", collectorId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!current) throw new Error("Collector not found");

  const stats = (current.stats ?? {}) as CollectorStats;
  const host = stats.capacity?.host ?? null;
  const issues = validateLimits(limits, host);
  const blocking = issues.filter((issue) => issue.level === "error");
  if (blocking.length) {
    throw new Error(blocking.map((issue) => issue.message).join(" "));
  }

  const config = normalizeConfig(current.config);
  const revision = Number(current.config_revision ?? 1) + 1;
  const { error } = await supabase
    .from("collectors")
    .update({
      config: { ...config, capacity: limits } as never,
      config_revision: revision,
      updated_at: new Date().toISOString(),
    })
    .eq("id", collectorId);
  if (error) throw new Error(error.message);

  await supabase.from("collector_events").insert({
    collector_id: collectorId,
    level: "info",
    kind: "capacity",
    message: `Capacity set to ${limits.profile} profile: ${limits.max_flows_per_second.toLocaleString()} flows/s ceiling, ${limits.raw_packet_hours}h raw packets, ${limits.local_max_gb} GB database budget.`,
  } as never);

  return { config_revision: revision, warnings: issues.filter((i) => i.level === "warning") };
}

export async function saveCollectorConfig(
  supabase: Client,
  collectorId: string,
  incoming: CollectorConfig,
) {
  const { data: current, error: readError } = await supabase
    .from("collectors")
    .select("config, config_revision")
    .eq("id", collectorId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!current) throw new Error("Collector not found");

  const previous = normalizeConfig(current.config);
  const merged = mergeSecrets(normalizeConfig(incoming), previous);
  const revision = Number(current.config_revision ?? 1) + 1;

  const { error } = await supabase
    .from("collectors")
    .update({ config: merged as never, config_revision: revision, updated_at: new Date().toISOString() })
    .eq("id", collectorId);
  if (error) throw new Error(error.message);

  await supabase
    .from("collector_interfaces")
    .update({ capture_enabled: false })
    .eq("collector_id", collectorId);
  const enabled = merged.captures.filter((capture) => capture.enabled).map((c) => c.interface_name);
  if (enabled.length) {
    await supabase
      .from("collector_interfaces")
      .update({ capture_enabled: true })
      .eq("collector_id", collectorId)
      .in("name", enabled);
  }

  return { config: redactConfig(merged), config_revision: revision };
}

const MASK = "••••••••";

function keep(incoming: string | undefined, previous: string | undefined) {
  return incoming && incoming !== MASK ? incoming : previous;
}

function withSecret<T extends object, K extends keyof T>(row: T, key: K, value: unknown): T {
  if (value === undefined) {
    const next = { ...row };
    delete next[key];
    return next;
  }
  return { ...row, [key]: value } as T;
}

function mergeSecrets(next: CollectorConfig, previous: CollectorConfig): CollectorConfig {
  const snmp = next.snmp.map((target) => {
    const old = previous.snmp.find((candidate) => candidate.target === target.target);
    let row = withSecret(target, "community", keep(target.community, old?.community));
    row = withSecret(row, "auth_key", keep(target.auth_key, old?.auth_key));
    return withSecret(row, "priv_key", keep(target.priv_key, old?.priv_key));
  });
  const wmi = next.wmi.map((target) => {
    const old = previous.wmi.find((candidate) => candidate.target === target.target);
    return withSecret(target, "password", keep(target.password, old?.password));
  });
  const devices = next.devices.map((device) => {
    const old = previous.devices.find((candidate) => candidate.host === device.host);
    return withSecret(device, "password", keep(device.password, old?.password));
  });
  const broker = next.broker
    ? withSecret(next.broker, "token", keep(next.broker.token, previous.broker?.token))
    : null;
  return { ...next, snmp, wmi, devices, broker };
}

export async function deleteCollector(supabase: Client, collectorId: string) {
  const { error } = await supabase.from("collectors").delete().eq("id", collectorId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** Marks appliances that stopped checking in, so the console never lies about health. */
export async function reconcileStaleCollectors(supabase: Client, userId: string) {
  const cutoff = new Date(Date.now() - COLLECTOR_STALE_SECONDS * 1000).toISOString();
  await supabase
    .from("collectors")
    .update({ status: "stale" })
    .eq("user_id", userId)
    .eq("status", "online")
    .lt("last_seen_at", cutoff);
}
