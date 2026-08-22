import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import type { MatrixDevice, MatrixLink, MatrixPolicy, MatrixPort } from "./matrix-types";

type Client = SupabaseClient<Database>;

async function resolveConnectionIds(supabase: Client, userId: string, connectionId?: string | null) {
  if (connectionId) return [connectionId];
  const { data } = await supabase.from("matrix_connections" as never).select("id").eq("user_id", userId);
  return ((data ?? []) as unknown as { id: string }[]).map((r) => r.id);
}

/**
 * Tools exposed to the model for the MATRIX read-only telemetry layer.
 * Every tool returns compact JSON with ids so answers can cite evidence.
 */
export function createMatrixTools(supabase: Client, userId: string) {
  return {
    matrix_fabric_inventory: tool({
      description:
        "List MATRIX fabric devices, ports and links with health, optionally filtered by connection or site.",
      inputSchema: z.object({
        connection_id: z.string().nullable().optional(),
        site: z.string().nullable().optional(),
      }),
      execute: async ({ connection_id, site }) => {
        const ids = await resolveConnectionIds(supabase, userId, connection_id);
        if (!ids.length) return { error: "No MATRIX connections configured." };
        let deviceQuery = supabase.from("matrix_devices" as never).select("*").in("connection_id", ids);
        if (site) deviceQuery = deviceQuery.eq("site", site);
        const { data: devices, error: dErr } = await deviceQuery;
        if (dErr) throw new Error(dErr.message);
        const deviceRows = ((devices ?? []) as unknown) as MatrixDevice[];
        const deviceIds = deviceRows.map((d) => d.id);
        const { data: ports } = deviceIds.length
          ? await supabase.from("matrix_ports" as never).select("*").in("device_id", deviceIds)
          : { data: [] };
        const portRows = ((ports ?? []) as unknown) as MatrixPort[];
        const { data: links } = await supabase.from("matrix_links" as never).select("*").in("connection_id", ids);
        const linkRows = ((links ?? []) as unknown) as MatrixLink[];

        return {
          devices: deviceRows.map((d) => ({
            id: d.id,
            device_key: d.device_key,
            name: d.name,
            site: d.site,
            role: d.role,
            model: d.model,
            health_status: d.health_status,
            last_seen_at: d.last_seen_at,
          })),
          ports: portRows.map((p) => ({
            id: p.id,
            device_id: p.device_id,
            port_key: p.port_key,
            name: p.name,
            kind: p.kind,
            speed_bps: p.speed_bps,
            admin_state: p.admin_state,
            oper_state: p.oper_state,
          })),
          links: linkRows.map((l) => ({
            id: l.id,
            link_key: l.link_key,
            kind: l.kind,
            status: l.status,
            src_port_id: l.src_port_id,
            dst_port_id: l.dst_port_id,
          })),
        };
      },
    }),

    matrix_visibility_path: tool({
      description:
        "Trace what a tool actually receives from an ingress TAP/SPAN port or source IP/segment through the visibility policies to the tool ports, and report blind spots.",
      inputSchema: z.object({
        connection_id: z.string().nullable().optional(),
        ingress_port_key: z.string().nullable().optional(),
        source: z.string().nullable().optional(),
      }),
      execute: async ({ connection_id, ingress_port_key }) => {
        const ids = await resolveConnectionIds(supabase, userId, connection_id);
        if (!ids.length) return { error: "No MATRIX connections configured." };
        const { data: policies } = await supabase.from("matrix_policies" as never).select("*").in("connection_id", ids);
        const policyRows = ((policies ?? []) as unknown) as MatrixPolicy[];
        const { data: ports } = await supabase.from("matrix_ports" as never).select("*").in("connection_id", ids);
        const portRows = ((ports ?? []) as unknown) as MatrixPort[];
        const portByKey = new Map(portRows.map((p) => [p.port_key, p]));

        const matching = ingress_port_key
          ? policyRows.filter((p) => p.ingress_ports.includes(ingress_port_key))
          : policyRows;

        const toolPortKeys = new Set<string>();
        for (const p of matching) for (const key of p.egress_ports) toolPortKeys.add(key);

        const allTapSpanPorts = portRows.filter((p) => p.kind === "tap" || p.kind === "span");
        const coveredIngress = new Set(matching.flatMap((p) => p.ingress_ports));
        const blindSpots = allTapSpanPorts.filter((p) => !coveredIngress.has(p.port_key)).map((p) => p.port_key);

        return {
          ingress_port_key: ingress_port_key ?? null,
          matched_policies: matching.map((p) => ({
            id: p.id,
            policy_key: p.policy_key,
            name: p.name,
            enabled: p.enabled,
            priority: p.priority,
            actions: p.actions,
            egress_ports: p.egress_ports,
          })),
          tool_ports_receiving: [...toolPortKeys].map((key) => ({
            port_key: key,
            port: portByKey.get(key) ? { id: portByKey.get(key)!.id, name: portByKey.get(key)!.name } : null,
          })),
          blind_spot_ports_without_policy: blindSpots,
        };
      },
    }),

    matrix_policy_diff: tool({
      description:
        "Compare visibility policies between two MATRIX config revisions and report added, removed and changed policies.",
      inputSchema: z.object({
        connection_id: z.string(),
        from_revision: z.number(),
        to_revision: z.number(),
      }),
      execute: async ({ connection_id, from_revision, to_revision }) => {
        const { loadPolicyDiff } = await import("./matrix.server");
        const diff = await loadPolicyDiff(supabase, userId, connection_id, from_revision, to_revision);
        return { from_revision, to_revision, changes: diff };
      },
    }),

    matrix_port_health: tool({
      description:
        "Report counters, utilization, errors, discards and active alarms for a MATRIX port or all ports on a device.",
      inputSchema: z.object({
        connection_id: z.string().nullable().optional(),
        port_key: z.string().nullable().optional(),
        device_key: z.string().nullable().optional(),
      }),
      execute: async ({ connection_id, port_key, device_key }) => {
        const ids = await resolveConnectionIds(supabase, userId, connection_id);
        if (!ids.length) return { error: "No MATRIX connections configured." };
        let portQuery = supabase.from("matrix_ports" as never).select("*").in("connection_id", ids);
        if (port_key) portQuery = portQuery.eq("port_key", port_key);
        if (device_key) {
          const { data: dev } = await supabase
            .from("matrix_devices" as never)
            .select("id")
            .in("connection_id", ids)
            .eq("device_key", device_key)
            .maybeSingle();
          if (dev) portQuery = portQuery.eq("device_id", (dev as unknown as { id: string }).id);
        }
        const { data: ports, error } = await portQuery;
        if (error) throw new Error(error.message);
        const portRows = ((ports ?? []) as unknown) as MatrixPort[];
        const portIds = portRows.map((p) => p.id);

        const since = new Date(Date.now() - 3600_000).toISOString();
        const { data: counters } = portIds.length
          ? await supabase
              .from("matrix_port_counters" as never)
              .select("*")
              .in("port_id", portIds)
              .gte("bucket_ts", since)
              .order("bucket_ts", { ascending: false })
              .limit(500)
          : { data: [] };

        const { data: alarms } = await supabase
          .from("matrix_alarms" as never)
          .select("*")
          .in("connection_id", ids)
          .eq("state", "active");
        const alarmRows = (alarms ?? []) as unknown as { port_key: string | null }[];

        return {
          ports: portRows.map((p) => {
            const latest = ((counters ?? []) as unknown as { port_id: string; utilization_pct: number | null; errors: number; discards: number; crc_errors: number; bucket_ts: string }[]).find(
              (c) => c.port_id === p.id,
            );
            return {
              id: p.id,
              port_key: p.port_key,
              name: p.name,
              kind: p.kind,
              admin_state: p.admin_state,
              oper_state: p.oper_state,
              latest_counter: latest ?? null,
              active_alarms: alarmRows.filter((a) => a.port_key === p.port_key).length,
            };
          }),
        };
      },
    }),
  };
}
