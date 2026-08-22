/**
 * Server-only persistence + sync for the MATRIX read-only telemetry layer.
 * Polls a MATRIX adapter (simulator or live) and upserts normalized rows into
 * the matrix_* tables. Never issues writes back to the fabric itself.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  MatrixAlarm,
  MatrixConfigRevision,
  MatrixConnectionSummary,
  MatrixDevice,
  MatrixLink,
  MatrixMode,
  MatrixPolicy,
  MatrixPolicyDiffEntry,
  MatrixPort,
  MatrixPortCounterSample,
  MatrixTopology,
} from "./matrix-types";

type Client = SupabaseClient<Database>;

const COUNTER_RETENTION_MS = 24 * 3600_000;

function toSummary(row: Record<string, unknown>): MatrixConnectionSummary {
  return {
    id: String(row["id"]),
    name: String(row["name"]),
    site: String(row["site"] ?? ""),
    mode: (row["mode"] as MatrixMode) ?? "simulator",
    base_url: (row["base_url"] as string) ?? null,
    secret_name: (row["secret_name"] as string) ?? null,
    verify_tls: Boolean(row["verify_tls"]),
    poll_interval_seconds: Number(row["poll_interval_seconds"] ?? 60),
    status: String(row["status"] ?? "pending"),
    last_error: (row["last_error"] as string) ?? null,
    last_polled_at: (row["last_polled_at"] as string) ?? null,
    created_at: String(row["created_at"]),
    updated_at: String(row["updated_at"]),
  };
}

export async function listConnections(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("matrix_connections" as never)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toSummary);
}

export async function createConnection(
  supabase: Client,
  userId: string,
  input: {
    name: string;
    site: string;
    mode: MatrixMode;
    base_url: string | null;
    secret_name: string | null;
    verify_tls: boolean;
    poll_interval_seconds: number;
  },
) {
  const { data, error } = await supabase
    .from("matrix_connections" as never)
    .insert({ user_id: userId, ...input, status: "pending" } as never)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toSummary(data as unknown as Record<string, unknown>);
}

export async function updateConnection(
  supabase: Client,
  userId: string,
  id: string,
  patch: Partial<{
    name: string;
    site: string;
    mode: MatrixMode;
    base_url: string | null;
    secret_name: string | null;
    verify_tls: boolean;
    poll_interval_seconds: number;
  }>,
) {
  const { data, error } = await supabase
    .from("matrix_connections" as never)
    .update({ ...patch, updated_at: new Date().toISOString() } as never)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toSummary(data as unknown as Record<string, unknown>);
}

export async function deleteConnection(supabase: Client, userId: string, id: string) {
  const { error } = await supabase
    .from("matrix_connections" as never)
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function getConnectionOrThrow(supabase: Client, userId: string, id: string) {
  const { data, error } = await supabase
    .from("matrix_connections" as never)
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("MATRIX connection not found.");
  return toSummary(data as unknown as Record<string, unknown>);
}

/** Polls the adapter and persists the snapshot. Always safe to call repeatedly. */
export async function syncMatrixConnection(supabase: Client, userId: string, connectionId: string) {
  const connection = await getConnectionOrThrow(supabase, userId, connectionId);
  const { createMatrixAdapter } = await import("./matrix-adapter.server");
  const adapter = createMatrixAdapter(connection);

  try {
    const snapshot = await adapter.fetchSnapshot();
    await persistSnapshot(supabase, userId, connectionId, snapshot);

    await supabase
      .from("matrix_connections" as never)
      .update({
        status: "online",
        last_error: null,
        last_polled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", connectionId);

    return { ok: true, devices: snapshot.devices.length, ports: snapshot.ports.length };
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await supabase
      .from("matrix_connections" as never)
      .update({ status: "error", last_error: message, updated_at: new Date().toISOString() } as never)
      .eq("id", connectionId);
    throw err;
  }
}

async function persistSnapshot(
  supabase: Client,
  userId: string,
  connectionId: string,
  snapshot: import("./matrix-types").MatrixSnapshot,
) {
  if (snapshot.devices.length) {
    const { error } = await supabase.from("matrix_devices" as never).upsert(
      snapshot.devices.map((d: MatrixDevice) => ({
        id: d.id,
        user_id: userId,
        connection_id: connectionId,
        device_key: d.device_key,
        name: d.name,
        site: d.site,
        role: d.role,
        model: d.model,
        serial: d.serial,
        os_version: d.os_version,
        mgmt_ip: d.mgmt_ip,
        health_status: d.health_status,
        health: d.health as never,
        p4_state: d.p4_state as never,
        last_seen_at: d.last_seen_at,
      })) as never,
      { onConflict: "id" },
    );
    if (error) throw new Error(`device upsert failed: ${error.message}`);
  }

  if (snapshot.ports.length) {
    const { error } = await supabase.from("matrix_ports" as never).upsert(
      snapshot.ports.map((p: MatrixPort) => ({
        id: p.id,
        user_id: userId,
        connection_id: connectionId,
        device_id: p.device_id,
        port_key: p.port_key,
        name: p.name,
        kind: p.kind,
        speed_bps: p.speed_bps,
        admin_state: p.admin_state,
        oper_state: p.oper_state,
        media: p.media,
        description: p.description,
        extra: p.extra as never,
      })) as never,
      { onConflict: "id" },
    );
    if (error) throw new Error(`port upsert failed: ${error.message}`);
  }

  if (snapshot.links.length) {
    const { error } = await supabase.from("matrix_links" as never).upsert(
      snapshot.links.map((l: MatrixLink) => ({
        id: l.id,
        user_id: userId,
        connection_id: connectionId,
        src_port_id: l.src_port_id,
        dst_port_id: l.dst_port_id,
        link_key: l.link_key,
        kind: l.kind,
        status: l.status,
        extra: l.extra as never,
      })) as never,
      { onConflict: "id" },
    );
    if (error) throw new Error(`link upsert failed: ${error.message}`);
  }

  if (snapshot.policies.length) {
    const { error } = await supabase.from("matrix_policies" as never).upsert(
      snapshot.policies.map((p: MatrixPolicy) => ({
        id: p.id,
        user_id: userId,
        connection_id: connectionId,
        policy_key: p.policy_key,
        name: p.name,
        device_key: p.device_key,
        enabled: p.enabled,
        priority: p.priority,
        ingress_ports: p.ingress_ports,
        egress_ports: p.egress_ports,
        actions: p.actions as never,
        match_rules: p.match_rules as never,
        revision: p.revision,
        updated_at: new Date().toISOString(),
      })) as never,
      { onConflict: "id" },
    );
    if (error) throw new Error(`policy upsert failed: ${error.message}`);
  }

  if (snapshot.alarms.length) {
    const { error } = await supabase.from("matrix_alarms" as never).upsert(
      snapshot.alarms.map((a: MatrixAlarm) => ({
        id: a.id,
        user_id: userId,
        connection_id: connectionId,
        alarm_key: a.alarm_key,
        device_key: a.device_key,
        port_key: a.port_key,
        severity: a.severity,
        state: a.state,
        category: a.category,
        message: a.message,
        raised_at: a.raised_at,
        cleared_at: a.cleared_at,
        extra: a.extra as never,
      })) as never,
      { onConflict: "id" },
    );
    if (error) throw new Error(`alarm upsert failed: ${error.message}`);
  }

  if (snapshot.configRevision) {
    const rev = snapshot.configRevision;
    const { error } = await supabase.from("matrix_config_revisions" as never).upsert(
      [
        {
          id: rev.id,
          user_id: userId,
          connection_id: connectionId,
          revision: rev.revision,
          author: rev.author,
          summary: rev.summary,
          snapshot: rev.snapshot as never,
          captured_at: rev.captured_at,
        },
      ] as never,
      { onConflict: "id" },
    );
    if (error) throw new Error(`config revision upsert failed: ${error.message}`);
  }

  if (snapshot.counters.length) {
    const { error } = await supabase.from("matrix_port_counters" as never).insert(
      snapshot.counters.map((c: MatrixPortCounterSample) => ({
        user_id: userId,
        connection_id: connectionId,
        port_id: c.port_id,
        bucket_ts: c.bucket_ts,
        rx_bytes: c.rx_bytes,
        tx_bytes: c.tx_bytes,
        rx_packets: c.rx_packets,
        tx_packets: c.tx_packets,
        errors: c.errors,
        discards: c.discards,
        crc_errors: c.crc_errors,
        utilization_pct: c.utilization_pct,
      })) as never,
    );
    if (error) throw new Error(`counter insert failed: ${error.message}`);

    const cutoff = new Date(Date.now() - COUNTER_RETENTION_MS).toISOString();
    await supabase
      .from("matrix_port_counters" as never)
      .delete()
      .eq("connection_id", connectionId)
      .lt("bucket_ts", cutoff);
  }
}

export async function loadMatrixOverview(supabase: Client, userId: string) {
  const connections = await listConnections(supabase, userId);
  if (!connections.length) return { connections: [], deviceCount: 0, alarmCount: 0 };

  const ids = connections.map((c) => c.id);
  const [{ data: devices }, { data: alarms }] = await Promise.all([
    supabase.from("matrix_devices" as never).select("id, connection_id").in("connection_id", ids),
    supabase
      .from("matrix_alarms" as never)
      .select("id, connection_id")
      .in("connection_id", ids)
      .eq("state", "active"),
  ]);

  return {
    connections,
    deviceCount: (devices as unknown[] | null)?.length ?? 0,
    alarmCount: (alarms as unknown[] | null)?.length ?? 0,
  };
}

export async function loadTopology(supabase: Client, userId: string, connectionId: string): Promise<MatrixTopology> {
  await getConnectionOrThrow(supabase, userId, connectionId);
  const [{ data: devices, error: dErr }, { data: ports, error: pErr }, { data: links, error: lErr }] =
    await Promise.all([
      supabase.from("matrix_devices" as never).select("*").eq("connection_id", connectionId),
      supabase.from("matrix_ports" as never).select("*").eq("connection_id", connectionId),
      supabase.from("matrix_links" as never).select("*").eq("connection_id", connectionId),
    ]);
  if (dErr) throw new Error(dErr.message);
  if (pErr) throw new Error(pErr.message);
  if (lErr) throw new Error(lErr.message);

  const deviceRows = ((devices ?? []) as unknown) as MatrixDevice[];
  const portRows = ((ports ?? []) as unknown) as MatrixPort[];
  const linkRows = ((links ?? []) as unknown) as MatrixLink[];

  const nodes: MatrixTopology["nodes"] = [
    ...deviceRows.map((d) => ({
      id: d.id,
      kind: "device" as const,
      label: d.name,
      site: d.site,
      role: d.role,
      health: d.health_status,
      data: d,
    })),
    ...portRows.map((p) => ({
      id: p.id,
      kind: "port" as const,
      label: p.name,
      site: deviceRows.find((d) => d.id === p.device_id)?.site ?? null,
      parentId: p.device_id,
      data: p,
    })),
  ];

  const edges: MatrixTopology["edges"] = linkRows
    .filter((l) => l.src_port_id && l.dst_port_id)
    .map((l) => ({ id: l.id, source: l.src_port_id as string, target: l.dst_port_id as string, kind: l.kind, status: l.status }));

  return { nodes, edges, devices: deviceRows, ports: portRows, links: linkRows };
}

export async function loadPortCounters(
  supabase: Client,
  userId: string,
  connectionId: string,
  portId: string,
  minutes: number,
): Promise<MatrixPortCounterSample[]> {
  await getConnectionOrThrow(supabase, userId, connectionId);
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const { data, error } = await supabase
    .from("matrix_port_counters" as never)
    .select("*")
    .eq("connection_id", connectionId)
    .eq("port_id", portId)
    .gte("bucket_ts", since)
    .order("bucket_ts", { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown) as MatrixPortCounterSample[];
}

export async function loadAlarms(supabase: Client, userId: string, connectionId: string): Promise<MatrixAlarm[]> {
  await getConnectionOrThrow(supabase, userId, connectionId);
  const { data, error } = await supabase
    .from("matrix_alarms" as never)
    .select("*")
    .eq("connection_id", connectionId)
    .order("raised_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown) as MatrixAlarm[];
}

export async function loadPolicies(supabase: Client, userId: string, connectionId: string): Promise<MatrixPolicy[]> {
  await getConnectionOrThrow(supabase, userId, connectionId);
  const { data, error } = await supabase
    .from("matrix_policies" as never)
    .select("*")
    .eq("connection_id", connectionId)
    .order("priority", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown) as MatrixPolicy[];
}

export async function loadConfigRevisions(
  supabase: Client,
  userId: string,
  connectionId: string,
): Promise<MatrixConfigRevision[]> {
  await getConnectionOrThrow(supabase, userId, connectionId);
  const { data, error } = await supabase
    .from("matrix_config_revisions" as never)
    .select("*")
    .eq("connection_id", connectionId)
    .order("revision", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown) as MatrixConfigRevision[];
}

export async function loadPolicyDiff(
  supabase: Client,
  userId: string,
  connectionId: string,
  fromRevision: number,
  toRevision: number,
): Promise<MatrixPolicyDiffEntry[]> {
  await getConnectionOrThrow(supabase, userId, connectionId);
  const { data, error } = await supabase
    .from("matrix_config_revisions" as never)
    .select("*")
    .eq("connection_id", connectionId)
    .in("revision", [fromRevision, toRevision]);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as unknown) as MatrixConfigRevision[];
  const from = rows.find((r) => r.revision === fromRevision);
  const to = rows.find((r) => r.revision === toRevision);

  const fromPolicies = extractPolicies(from);
  const toPolicies = extractPolicies(to);

  return diffPolicies(fromPolicies, toPolicies);
}

function extractPolicies(rev: MatrixConfigRevision | undefined): MatrixPolicy[] {
  if (!rev) return [];
  const snap = rev.snapshot as { policies?: MatrixPolicy[] };
  return Array.isArray(snap?.policies) ? snap.policies : [];
}

const DIFF_FIELDS: (keyof MatrixPolicy)[] = [
  "enabled",
  "priority",
  "ingress_ports",
  "egress_ports",
  "actions",
  "match_rules",
];

function diffPolicies(before: MatrixPolicy[], after: MatrixPolicy[]): MatrixPolicyDiffEntry[] {
  const beforeMap = new Map(before.map((p) => [p.policy_key, p]));
  const afterMap = new Map(after.map((p) => [p.policy_key, p]));
  const entries: MatrixPolicyDiffEntry[] = [];

  for (const [key, p] of afterMap) {
    const prior = beforeMap.get(key);
    if (!prior) {
      entries.push({ policy_key: key, name: p.name, change: "added", after: p });
      continue;
    }
    const changedFields = DIFF_FIELDS.filter(
      (field) => JSON.stringify(prior[field]) !== JSON.stringify(p[field]),
    );
    if (changedFields.length) {
      entries.push({ policy_key: key, name: p.name, change: "changed", before: prior, after: p, fields_changed: changedFields });
    }
  }
  for (const [key, p] of beforeMap) {
    if (!afterMap.has(key)) entries.push({ policy_key: key, name: p.name, change: "removed", before: p });
  }
  return entries;
}
