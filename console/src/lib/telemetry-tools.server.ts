import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { embedTexts } from "./local-embeddings.server";
import { describeVantage } from "./ingest-types";
import { RISK_TAG_NOTES } from "./dissect";
import {
  HISTORY_SCHEMA_DOC,
  HISTORY_VIEWS,
  summarizeHistoryRows,
  validateHistorySql,
  type HistoryRow,
} from "./history-sql";

type Client = SupabaseClient<Database>;

const MAX_SCAN = 20000;

export type FlowRow = Database["public"]["Tables"]["flow_records"]["Row"];
export type LogRow = Database["public"]["Tables"]["log_records"]["Row"];

function flowEvidence(row: FlowRow) {
  return {
    id: row.id,
    ts: row.ts,
    src: row.src_ip ? `${row.src_ip}${row.src_port ? `:${row.src_port}` : ""}` : null,
    dst: row.dst_ip ? `${row.dst_ip}${row.dst_port ? `:${row.dst_port}` : ""}` : null,
    protocol: row.protocol,
    bytes: row.bytes,
    packets: row.packets,
    flags: row.flags,
    observation_point: row.observation_point,
  };
}

function logEvidence(row: LogRow) {
  return {
    id: row.id,
    ts: row.ts,
    host: row.host,
    severity: row.severity,
    message: row.message,
  };
}

async function fetchFlows(
  supabase: Client,
  datasetId: string,
  filters: {
    src_ip?: string | null;
    dst_ip?: string | null;
    ip?: string | null;
    protocol?: string | null;
    dst_port?: number | null;
    after?: string | null;
    before?: string | null;
    min_bytes?: number | null;
  },
  limit: number,
) {
  let query = supabase
    .from("flow_records")
    .select("*")
    .eq("dataset_id", datasetId)
    .order("bytes", { ascending: false })
    .limit(limit);

  if (filters.src_ip) query = query.eq("src_ip", filters.src_ip);
  if (filters.dst_ip) query = query.eq("dst_ip", filters.dst_ip);
  if (filters.ip) query = query.or(`src_ip.eq.${filters.ip},dst_ip.eq.${filters.ip}`);
  if (filters.protocol) query = query.ilike("protocol", filters.protocol);
  if (typeof filters.dst_port === "number") query = query.eq("dst_port", filters.dst_port);
  if (filters.after) query = query.gte("ts", filters.after);
  if (filters.before) query = query.lte("ts", filters.before);
  if (typeof filters.min_bytes === "number") query = query.gte("bytes", filters.min_bytes);

  const { data, error } = await query;
  if (error) throw new Error(`flow query failed: ${error.message}`);
  return data ?? [];
}

/**
 * Telemetry tools exposed to the model. Every tool returns concrete records so
 * answers can cite evidence instead of speculating.
 */
export function createTelemetryTools(
  supabase: Client,
  datasetId: string,
) {
  return {
    dataset_overview: tool({
      description:
        "Summarize the active telemetry dataset: record counts, time range, top talkers, protocols and observation points. Call this first when the user asks a broad question.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data: dataset, error } = await supabase
          .from("datasets")
          .select("*")
          .eq("id", datasetId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!dataset) return { error: "Dataset not found." };

        if (dataset.kind === "log") {
          const { data: logs } = await supabase
            .from("log_records")
            .select("*")
            .eq("dataset_id", datasetId)
            .limit(MAX_SCAN);
          const rows = logs ?? [];
          const bySeverity = new Map<string, number>();
          const byHost = new Map<string, number>();
          for (const row of rows) {
            const severity = row.severity ?? "unknown";
            bySeverity.set(severity, (bySeverity.get(severity) ?? 0) + 1);
            const host = row.host ?? "unknown";
            byHost.set(host, (byHost.get(host) ?? 0) + 1);
          }
          return {
            dataset: {
              name: dataset.name,
              kind: dataset.kind,
              records: dataset.record_count,
              range: { start: dataset.range_start, end: dataset.range_end },
              source: dataset.source_filename,
              capture_vantage: describeVantage(dataset.vantage).label,
              observation_point: dataset.observation_point,
              vantage_blind_spots: describeVantage(dataset.vantage).blindSpots,
            },
            severities: [...bySeverity.entries()].map(([severity, count]) => ({ severity, count })),
            top_hosts: [...byHost.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([host, count]) => ({ host, count })),
          };
        }

        if (dataset.kind === "packet") {
          const { data: packets, error: packetError } = await supabase
            .from("packet_records")
            .select("id, ts, src_ip, dst_ip, protocol, length, tcp_flags")
            .eq("dataset_id", datasetId)
            .limit(MAX_SCAN);
          if (packetError) throw new Error(packetError.message);
          const rows = packets ?? [];
          const protocols = new Map<string, number>();
          const talkers = new Map<string, number>();
          let bytes = 0;
          for (const row of rows) {
            bytes += row.length ?? 0;
            const protocol = row.protocol ?? "unknown";
            protocols.set(protocol, (protocols.get(protocol) ?? 0) + 1);
            if (row.src_ip) talkers.set(row.src_ip, (talkers.get(row.src_ip) ?? 0) + (row.length ?? 0));
          }
          return {
            dataset: {
              name: dataset.name,
              kind: dataset.kind,
              records: dataset.record_count,
              range: { start: dataset.range_start, end: dataset.range_end },
              source: dataset.source_filename,
              capture_vantage: describeVantage(dataset.vantage).label,
              observation_point: dataset.observation_point,
              vantage_blind_spots: describeVantage(dataset.vantage).blindSpots,
            },
            decoded_packets: rows.length,
            total_bytes: bytes,
            protocols: [...protocols.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([protocol, count]) => ({ protocol, packets: count })),
            top_talkers: [...talkers.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([ip, total]) => ({ ip, bytes: total })),
            evidence_packet_ids: rows.slice(0, 20).map((row) => row.id),
          };
        }

        if (dataset.kind === "snmp") {
          const { data: samples, error: snmpError } = await supabase
            .from("snmp_records")
            .select("id, host, interface_name, metric, value")
            .eq("dataset_id", datasetId)
            .limit(MAX_SCAN);
          if (snmpError) throw new Error(snmpError.message);
          const rows = samples ?? [];
          const metrics = new Map<string, number>();
          const hosts = new Map<string, number>();
          for (const row of rows) {
            const metric = row.metric ?? "unknown";
            const host = row.host ?? "unknown";
            metrics.set(metric, (metrics.get(metric) ?? 0) + 1);
            hosts.set(host, (hosts.get(host) ?? 0) + 1);
          }
          return {
            dataset: {
              name: dataset.name,
              kind: dataset.kind,
              records: dataset.record_count,
              range: { start: dataset.range_start, end: dataset.range_end },
              source: dataset.source_filename,
              capture_vantage: describeVantage(dataset.vantage).label,
              observation_point: dataset.observation_point,
              vantage_blind_spots: describeVantage(dataset.vantage).blindSpots,
            },
            samples: rows.length,
            metrics: [...metrics.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 20)
              .map(([metric, count]) => ({ metric, samples: count })),
            hosts: [...hosts.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 20)
              .map(([host, count]) => ({ host, samples: count })),
            evidence_snmp_ids: rows.slice(0, 20).map((row) => row.id),
          };
        }

        if (dataset.kind === "wmi") {
          const { data: records, error: wmiError } = await supabase
            .from("wmi_records")
            .select("id, host, wmi_class, event_id, level")
            .eq("dataset_id", datasetId)
            .limit(MAX_SCAN);
          if (wmiError) throw new Error(wmiError.message);
          const rows = records ?? [];
          const classes = new Map<string, number>();
          const levels = new Map<string, number>();
          for (const row of rows) {
            const wmiClass = row.wmi_class ?? "unknown";
            const level = row.level ?? "unknown";
            classes.set(wmiClass, (classes.get(wmiClass) ?? 0) + 1);
            levels.set(level, (levels.get(level) ?? 0) + 1);
          }
          return {
            dataset: {
              name: dataset.name,
              kind: dataset.kind,
              records: dataset.record_count,
              range: { start: dataset.range_start, end: dataset.range_end },
              source: dataset.source_filename,
              capture_vantage: describeVantage(dataset.vantage).label,
              observation_point: dataset.observation_point,
              vantage_blind_spots: describeVantage(dataset.vantage).blindSpots,
            },
            records: rows.length,
            classes: [...classes.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 20)
              .map(([wmi_class, count]) => ({ wmi_class, records: count })),
            levels: [...levels.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([level, count]) => ({ level, records: count })),
            evidence_wmi_ids: rows.slice(0, 20).map((row) => row.id),
          };
        }

        const { data: flows } = await supabase
          .from("flow_records")
          .select("*")
          .eq("dataset_id", datasetId)
          .limit(MAX_SCAN);
        const rows = flows ?? [];
        const talkers = new Map<string, number>();
        const protocols = new Map<string, number>();
        const taps = new Map<string, number>();
        let bytes = 0;
        for (const row of rows) {
          bytes += row.bytes ?? 0;
          if (row.src_ip) talkers.set(row.src_ip, (talkers.get(row.src_ip) ?? 0) + (row.bytes ?? 0));
          const protocol = row.protocol ?? "unknown";
          protocols.set(protocol, (protocols.get(protocol) ?? 0) + 1);
          const tap = row.observation_point ?? "unspecified";
          taps.set(tap, (taps.get(tap) ?? 0) + 1);
        }

        return {
          dataset: {
            name: dataset.name,
            kind: dataset.kind,
            records: dataset.record_count,
            range: { start: dataset.range_start, end: dataset.range_end },
            source: dataset.source_filename,
            capture_vantage: describeVantage(dataset.vantage).label,
            observation_point: dataset.observation_point,
            vantage_blind_spots: describeVantage(dataset.vantage).blindSpots,
          },
          total_bytes: bytes,
          top_talkers: [...talkers.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([ip, total]) => ({ ip, bytes: total })),
          protocols: [...protocols.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([protocol, flows_count]) => ({ protocol, flows: flows_count })),
          observation_points: [...taps.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([point, flows_count]) => ({ point, flows: flows_count })),
        };
      },
    }),

    flow_aggregate: tool({
      description:
        "Aggregate flow records (IPFIX/NetFlow/packet-broker exports) to rank talkers, conversations, ports, protocols or observation points by bytes, packets or flow count.",
      inputSchema: z.object({
        group_by: z.enum([
          "src_ip",
          "dst_ip",
          "conversation",
          "protocol",
          "dst_port",
          "observation_point",
        ]),
        metric: z.enum(["bytes", "packets", "flows"]),
        src_ip: z.string().nullable(),
        dst_ip: z.string().nullable(),
        protocol: z.string().nullable(),
        dst_port: z.number().nullable(),
        after: z.string().nullable(),
        before: z.string().nullable(),
        limit: z.number().nullable(),
      }),
      execute: async (input) => {
        const rows = await fetchFlows(
          supabase,
          datasetId,
          {
            src_ip: input.src_ip,
            dst_ip: input.dst_ip,
            protocol: input.protocol,
            dst_port: input.dst_port,
            after: input.after,
            before: input.before,
          },
          MAX_SCAN,
        );

        const buckets = new Map<string, { value: number; ids: number[] }>();
        for (const row of rows) {
          const key =
            input.group_by === "conversation"
              ? `${row.src_ip ?? "?"} -> ${row.dst_ip ?? "?"}`
              : String(row[input.group_by] ?? "unknown");
          const increment =
            input.metric === "bytes"
              ? (row.bytes ?? 0)
              : input.metric === "packets"
                ? (row.packets ?? 0)
                : 1;
          const bucket = buckets.get(key);
          if (bucket) {
            bucket.value += increment;
            if (bucket.ids.length < 8) bucket.ids.push(row.id);
          } else {
            buckets.set(key, { value: increment, ids: [row.id] });
          }
        }

        const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
        return {
          scanned_flows: rows.length,
          metric: input.metric,
          group_by: input.group_by,
          results: [...buckets.entries()]
            .sort((a, b) => b[1].value - a[1].value)
            .slice(0, limit)
            .map(([key, bucket]) => ({
              key,
              [input.metric]: bucket.value,
              evidence_flow_ids: bucket.ids,
            })),
        };
      },
    }),

    flow_search: tool({
      description:
        "Return individual flow records matching filters, newest/largest first. Use this to gather citable evidence for a claim.",
      inputSchema: z.object({
        ip: z.string().nullable(),
        src_ip: z.string().nullable(),
        dst_ip: z.string().nullable(),
        protocol: z.string().nullable(),
        dst_port: z.number().nullable(),
        min_bytes: z.number().nullable(),
        after: z.string().nullable(),
        before: z.string().nullable(),
        limit: z.number().nullable(),
      }),
      execute: async (input) => {
        const limit = Math.min(Math.max(input.limit ?? 25, 1), 200);
        const rows = await fetchFlows(supabase, datasetId, input, limit);
        return { count: rows.length, flows: rows.map(flowEvidence) };
      },
    }),

    log_search: tool({
      description:
        "Full-text search device/syslog records in the dataset, optionally filtered by severity, host or time window.",
      inputSchema: z.object({
        contains: z.string().nullable(),
        severity: z.string().nullable(),
        host: z.string().nullable(),
        after: z.string().nullable(),
        before: z.string().nullable(),
        limit: z.number().nullable(),
      }),
      execute: async (input) => {
        let query = supabase
          .from("log_records")
          .select("*")
          .eq("dataset_id", datasetId)
          .order("ts", { ascending: false, nullsFirst: false })
          .limit(Math.min(Math.max(input.limit ?? 25, 1), 200));

        if (input.contains) query = query.ilike("message", `%${input.contains}%`);
        if (input.severity) query = query.ilike("severity", input.severity);
        if (input.host) query = query.ilike("host", `%${input.host}%`);
        if (input.after) query = query.gte("ts", input.after);
        if (input.before) query = query.lte("ts", input.before);

        const { data, error } = await query;
        if (error) throw new Error(`log query failed: ${error.message}`);
        return { count: data?.length ?? 0, logs: (data ?? []).map(logEvidence) };
      },
    }),

    semantic_search: tool({
      description:
        "Semantic (RAG) search over telemetry summaries when the question is fuzzy — e.g. 'unusual outbound behaviour' or 'signs of exfiltration'. Returns matching summaries plus the underlying record ids.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().nullable(),
      }),
      execute: async (input) => {
        const [embedding] = await embedTexts([input.query]);
        if (!embedding) return { matches: [] };

        const { data, error } = await supabase.rpc("match_telemetry_chunks", {
          query_embedding: JSON.stringify(embedding),
          target_dataset: datasetId,
          match_count: Math.min(Math.max(input.limit ?? 6, 1), 20),
        });
        if (error) throw new Error(`semantic search failed: ${error.message}`);

        return {
          matches: (data ?? []).map((match) => ({
            kind: match.kind,
            similarity: Number(match.similarity.toFixed(3)),
            summary: match.content,
            record_ids: match.record_ids.slice(0, 20),
          })),
        };
      },
    }),

    get_records: tool({
      description:
        "Fetch specific flow, log, packet, SNMP or WMI records by id, typically ids returned by search or aggregation tools, so they can be cited as evidence.",
      inputSchema: z.object({
        table: z.enum(["flow", "log", "packet", "snmp", "wmi"]),
        ids: z.array(z.number()),
      }),
      execute: async (input) => {
        const ids = input.ids.slice(0, 100);
        if (input.table === "flow") {
          const { data, error } = await supabase
            .from("flow_records")
            .select("*")
            .eq("dataset_id", datasetId)
            .in("id", ids);
          if (error) throw new Error(error.message);
          return { flows: (data ?? []).map(flowEvidence) };
        }
        if (input.table === "log") {
          const { data, error } = await supabase
            .from("log_records")
            .select("*")
            .eq("dataset_id", datasetId)
            .in("id", ids);
          if (error) throw new Error(error.message);
          return { logs: (data ?? []).map(logEvidence) };
        }
        if (input.table === "packet") {
          const { data, error } = await supabase
            .from("packet_records")
            .select("*")
            .eq("dataset_id", datasetId)
            .in("id", ids);
          if (error) throw new Error(error.message);
          return {
            packets: (data ?? []).map((row) => ({
              id: row.id,
              frame: row.frame_number,
              ts: row.ts,
              src: row.src_ip ? `${row.src_ip}${row.src_port ? `:${row.src_port}` : ""}` : null,
              dst: row.dst_ip ? `${row.dst_ip}${row.dst_port ? `:${row.dst_port}` : ""}` : null,
              protocol: row.protocol,
              length: row.length,
              tcp_flags: row.tcp_flags,
              info: row.info,
            })),
          };
        }
        if (input.table === "snmp") {
          const { data, error } = await supabase
            .from("snmp_records")
            .select("*")
            .eq("dataset_id", datasetId)
            .in("id", ids);
          if (error) throw new Error(error.message);
          return {
            samples: (data ?? []).map((row) => ({
              id: row.id,
              ts: row.ts,
              host: row.host,
              interface: row.interface_name,
              metric: row.metric,
              oid: row.oid,
              value: row.value ?? row.value_text,
            })),
          };
        }
        const { data, error } = await supabase
          .from("wmi_records")
          .select("*")
          .eq("dataset_id", datasetId)
          .in("id", ids);
        if (error) throw new Error(error.message);
        return {
          records: (data ?? []).map((row) => ({
            id: row.id,
            ts: row.ts,
            host: row.host,
            wmi_class: row.wmi_class,
            event_id: row.event_id,
            level: row.level,
            message: row.message.slice(0, 600),
          })),
        };
      },
    }),

    packet_search: tool({
      description:
        "Search individual decoded packets from a packet capture (frame number, addresses, ports, protocol, size, TCP flags). Use for packet-level proof such as retransmissions, SYN floods or handshake failures.",
      inputSchema: z.object({
        ip: z.string().nullable(),
        protocol: z.string().nullable(),
        dst_port: z.number().nullable(),
        tcp_flag: z.string().nullable(),
        after: z.string().nullable(),
        before: z.string().nullable(),
        limit: z.number().nullable(),
      }),
      execute: async (input) => {
        let query = supabase
          .from("packet_records")
          .select("*")
          .eq("dataset_id", datasetId)
          .order("ts", { ascending: true, nullsFirst: false })
          .limit(Math.min(Math.max(input.limit ?? 40, 1), 200));

        if (input.ip) query = query.or(`src_ip.eq.${input.ip},dst_ip.eq.${input.ip}`);
        if (input.protocol) query = query.ilike("protocol", input.protocol);
        if (input.dst_port !== null) query = query.eq("dst_port", input.dst_port);
        if (input.tcp_flag) query = query.ilike("tcp_flags", `%${input.tcp_flag}%`);
        if (input.after) query = query.gte("ts", input.after);
        if (input.before) query = query.lte("ts", input.before);

        const { data, error } = await query;
        if (error) throw new Error(`packet query failed: ${error.message}`);
        return {
          count: data?.length ?? 0,
          packets: (data ?? []).map((row) => ({
            id: row.id,
            frame: row.frame_number,
            ts: row.ts,
            src: row.src_ip ? `${row.src_ip}${row.src_port ? `:${row.src_port}` : ""}` : null,
            dst: row.dst_ip ? `${row.dst_ip}${row.dst_port ? `:${row.dst_port}` : ""}` : null,
            protocol: row.protocol,
            length: row.length,
            tcp_flags: row.tcp_flags,
            info: row.info,
          })),
        };
      },
    }),

    snmp_search: tool({
      description:
        "Query SNMP counter/gauge samples (per device, interface, OID or metric name) with basic statistics. Use for interface utilisation, errors, discards and uptime questions.",
      inputSchema: z.object({
        host: z.string().nullable(),
        interface_name: z.string().nullable(),
        metric: z.string().nullable(),
        after: z.string().nullable(),
        before: z.string().nullable(),
        limit: z.number().nullable(),
      }),
      execute: async (input) => {
        let query = supabase
          .from("snmp_records")
          .select("*")
          .eq("dataset_id", datasetId)
          .order("ts", { ascending: true, nullsFirst: false })
          .limit(Math.min(Math.max(input.limit ?? 200, 1), 2000));

        if (input.host) query = query.ilike("host", `%${input.host}%`);
        if (input.interface_name) query = query.ilike("interface_name", `%${input.interface_name}%`);
        if (input.metric) query = query.ilike("metric", `%${input.metric}%`);
        if (input.after) query = query.gte("ts", input.after);
        if (input.before) query = query.lte("ts", input.before);

        const { data, error } = await query;
        if (error) throw new Error(`snmp query failed: ${error.message}`);
        const rows = data ?? [];
        const numeric = rows.map((row) => row.value).filter((value): value is number => value !== null);
        return {
          count: rows.length,
          stats: numeric.length
            ? {
                min: Math.min(...numeric),
                max: Math.max(...numeric),
                avg: Number((numeric.reduce((total, value) => total + value, 0) / numeric.length).toFixed(3)),
              }
            : null,
          samples: rows.slice(0, 200).map((row) => ({
            id: row.id,
            ts: row.ts,
            host: row.host,
            interface: row.interface_name,
            metric: row.metric,
            oid: row.oid,
            value: row.value ?? row.value_text,
          })),
        };
      },
    }),

    wmi_search: tool({
      description:
        "Search WMI / Windows class and event records (host, class, event id, level, message) to correlate endpoint state with network behaviour.",
      inputSchema: z.object({
        contains: z.string().nullable(),
        host: z.string().nullable(),
        wmi_class: z.string().nullable(),
        level: z.string().nullable(),
        after: z.string().nullable(),
        before: z.string().nullable(),
        limit: z.number().nullable(),
      }),
      execute: async (input) => {
        let query = supabase
          .from("wmi_records")
          .select("*")
          .eq("dataset_id", datasetId)
          .order("ts", { ascending: false, nullsFirst: false })
          .limit(Math.min(Math.max(input.limit ?? 25, 1), 200));

        if (input.contains) query = query.ilike("message", `%${input.contains}%`);
        if (input.host) query = query.ilike("host", `%${input.host}%`);
        if (input.wmi_class) query = query.ilike("wmi_class", `%${input.wmi_class}%`);
        if (input.level) query = query.ilike("level", `%${input.level}%`);
        if (input.after) query = query.gte("ts", input.after);
        if (input.before) query = query.lte("ts", input.before);

        const { data, error } = await query;
        if (error) throw new Error(`wmi query failed: ${error.message}`);
        return {
          count: data?.length ?? 0,
          records: (data ?? []).map((row) => ({
            id: row.id,
            ts: row.ts,
            host: row.host,
            wmi_class: row.wmi_class,
            event_id: row.event_id,
            level: row.level,
            message: row.message.slice(0, 600),
          })),
        };
      },
    }),

    timeline: tool({
      description:
        "Bucket any telemetry source over time (packets, flows, logs, snmp, wmi) to spot spikes and gaps. Returns points ready to hand to render_chart.",
      inputSchema: z.object({
        source: z.enum(["packet", "flow", "log", "snmp", "wmi"]),
        metric: z.enum(["count", "bytes", "value"]),
        bucket_minutes: z.number().nullable(),
        ip: z.string().nullable(),
        host: z.string().nullable(),
        metric_name: z.string().nullable(),
        after: z.string().nullable(),
        before: z.string().nullable(),
      }),
      execute: async (input) => {
        const bucketMs = Math.min(Math.max(input.bucket_minutes ?? 5, 1), 1440) * 60_000;
        const table =
          input.source === "packet"
            ? "packet_records"
            : input.source === "flow"
              ? "flow_records"
              : input.source === "log"
                ? "log_records"
                : input.source === "snmp"
                  ? "snmp_records"
                  : "wmi_records";

        let query = supabase
          .from(table as never)
          .select("*")
          .eq("dataset_id", datasetId)
          .limit(MAX_SCAN);
        if (input.after) query = query.gte("ts", input.after);
        if (input.before) query = query.lte("ts", input.before);
        if (input.host) query = query.ilike("host", `%${input.host}%`);
        if (input.metric_name) query = query.ilike("metric", `%${input.metric_name}%`);
        if (input.ip && (input.source === "flow" || input.source === "packet")) {
          query = query.or(`src_ip.eq.${input.ip},dst_ip.eq.${input.ip}`);
        }

        const { data, error } = await query;
        if (error) throw new Error(`timeline query failed: ${error.message}`);

        const rows = (data ?? []) as unknown as {
          ts: string | null;
          bytes?: number | null;
          length?: number | null;
          value?: number | null;
        }[];
        const buckets = new Map<number, number>();
        for (const row of rows) {
          if (!row.ts) continue;
          const time = new Date(row.ts).getTime();
          if (!Number.isFinite(time)) continue;
          const key = Math.floor(time / bucketMs) * bucketMs;
          const increment =
            input.metric === "bytes"
              ? (row.bytes ?? row.length ?? 0)
              : input.metric === "value"
                ? (row.value ?? 0)
                : 1;
          buckets.set(key, (buckets.get(key) ?? 0) + increment);
        }

        return {
          source: input.source,
          metric: input.metric,
          bucket_minutes: bucketMs / 60_000,
          scanned: rows.length,
          points: [...buckets.entries()]
            .sort((a, b) => a[0] - b[0])
            .slice(0, 400)
            .map(([time, value]) => ({ label: new Date(time).toISOString(), value })),
        };
      },
    }),

    render_chart: tool({
      description:
        "Render a chart in the investigation UI. Provide the data points you already retrieved from timeline/flow_aggregate/snmp_search. Use this whenever a trend or ranking is easier to read visually.",
      inputSchema: z.object({
        type: z.enum(["line", "area", "bar"]),
        title: z.string(),
        y_label: z.string().nullable(),
        points: z.array(z.object({ label: z.string(), value: z.number() })),
      }),
      execute: async (input) => ({
        rendered: true,
        chart: {
          type: input.type,
          title: input.title,
          y_label: input.y_label,
          points: input.points.slice(0, 400),
        },
      }),
    }),

    render_diagram: tool({
      description:
        "Render a Mermaid diagram (topology, attack path, sequence) in the investigation UI. Pass valid Mermaid source, e.g. 'graph LR; A[10.0.0.5] --> B[8.8.8.8]'.",
      inputSchema: z.object({
        title: z.string(),
        mermaid: z.string(),
      }),
      execute: async (input) => ({
        rendered: true,
        diagram: { title: input.title, mermaid: input.mermaid.slice(0, 8000) },
      }),
    }),

    live_session_stats: tool({
      description:
        "Check whether this dataset is a live capture that is still streaming, and read the most recent per-slice rates, top talkers, protocols and destination ports. Use it for 'what is happening right now' questions and to state that the data is still in flight.",
      inputSchema: z.object({ buckets: z.number().nullable() }),
      execute: async (input) => {
        const { data: session, error } = await supabase
          .from("live_sessions")
          .select(
            "id, status, os, interface_name, capture_filter, slice_seconds, vantage, observation_point, packet_count, byte_count, batch_count, last_seen_at, created_at",
          )
          .eq("dataset_id", datasetId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!session) {
          return { live: false, note: "This dataset is not a live capture session." };
        }

        const limit = Math.min(120, Math.max(5, input.buckets ?? 20));
        const { data: rows } = await supabase
          .from("live_session_metrics")
          .select("bucket_ts, packets, bytes, top")
          .eq("session_id", session.id)
          .order("bucket_ts", { ascending: false })
          .limit(limit);
        const buckets = (rows ?? []).slice().reverse();
        const lastSeenSeconds = session.last_seen_at
          ? Math.round((Date.now() - new Date(session.last_seen_at).getTime()) / 1000)
          : null;

        return {
          live: session.status === "live" || session.status === "pending",
          status: session.status,
          streaming_from: `${session.interface_name} (${session.os} host agent)`,
          capture_filter: session.capture_filter,
          slice_seconds: session.slice_seconds,
          vantage: describeVantage(session.vantage).label,
          vantage_blind_spots: describeVantage(session.vantage).blindSpots,
          agent_last_seen_seconds_ago: lastSeenSeconds,
          packets_so_far: session.packet_count,
          bytes_so_far: session.byte_count,
          slices_received: session.batch_count,
          recent_slices: buckets.map((bucket) => ({
            at: bucket.bucket_ts,
            packets: bucket.packets,
            bytes: bucket.bytes,
            packets_per_second: Number(
              (bucket.packets / Math.max(1, session.slice_seconds)).toFixed(2),
            ),
          })),
          latest_top: buckets[buckets.length - 1]?.top ?? null,
          caveat:
            "This capture is still in progress, so counts are partial and the newest packets may not be indexed for semantic search yet.",
        };
      },
    }),
    protocol_breakdown: tool({
      description:
        "Break down dissected application-protocol traffic (packet_records.app_protocol/service, flow_records.app_protocol/service) by protocol and by service: counts, bytes, distinct peers and top ports. Flags protocols seen on non-standard ports. Prefer this over flow_aggregate/packet_search for 'what protocols/services are present' questions.",
      inputSchema: z.object({
        limit: z.number().nullable(),
      }),
      execute: async (input) => {
        const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);

        const [{ data: packets, error: packetError }, { data: flows, error: flowError }] = await Promise.all([
          supabase
            .from("packet_records")
            .select("src_ip, dst_ip, dst_port, protocol, app_protocol, service, risk_tags, length")
            .eq("dataset_id", datasetId)
            .limit(MAX_SCAN),
          supabase
            .from("flow_records")
            .select("src_ip, dst_ip, dst_port, protocol, app_protocol, service, risk_tags, bytes")
            .eq("dataset_id", datasetId)
            .limit(MAX_SCAN),
        ]);
        if (packetError) throw new Error(packetError.message);
        if (flowError) throw new Error(flowError.message);

        type Bucket = {
          bytes: number;
          count: number;
          peers: Set<string>;
          ports: Map<number, number>;
          non_standard_port_hits: number;
        };
        const byProtocol = new Map<string, Bucket>();
        const byService = new Map<string, Bucket>();

        const bump = (map: Map<string, Bucket>, key: string | null, bytes: number, peer: string | null, port: number | null, nonStandard: boolean) => {
          const bucketKey = key ?? "unknown";
          const bucket = map.get(bucketKey) ?? {
            bytes: 0,
            count: 0,
            peers: new Set<string>(),
            ports: new Map<number, number>(),
            non_standard_port_hits: 0,
          };
          bucket.bytes += bytes;
          bucket.count += 1;
          if (peer) bucket.peers.add(peer);
          if (port !== null) bucket.ports.set(port, (bucket.ports.get(port) ?? 0) + 1);
          if (nonStandard) bucket.non_standard_port_hits += 1;
          map.set(bucketKey, bucket);
        };

        for (const row of packets ?? []) {
          const peer = row.src_ip && row.dst_ip ? `${row.src_ip}<->${row.dst_ip}` : null;
          const nonStandard = (row.risk_tags ?? []).includes("non-standard-port");
          bump(byProtocol, row.app_protocol ?? row.protocol, row.length ?? 0, peer, row.dst_port, nonStandard);
          if (row.service) bump(byService, row.service, row.length ?? 0, peer, row.dst_port, nonStandard);
        }
        for (const row of flows ?? []) {
          const peer = row.src_ip && row.dst_ip ? `${row.src_ip}<->${row.dst_ip}` : null;
          const nonStandard = (row.risk_tags ?? []).includes("non-standard-port");
          bump(byProtocol, row.app_protocol ?? row.protocol, row.bytes ?? 0, peer, row.dst_port, nonStandard);
          if (row.service) bump(byService, row.service, row.bytes ?? 0, peer, row.dst_port, nonStandard);
        }

        const summarize = (map: Map<string, Bucket>) =>
          [...map.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, limit)
            .map(([key, bucket]) => ({
              key,
              records: bucket.count,
              bytes: bucket.bytes,
              distinct_peers: bucket.peers.size,
              top_ports: [...bucket.ports.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([port, count]) => ({ port, count })),
              non_standard_port_hits: bucket.non_standard_port_hits,
            }));

        return {
          scanned_packets: (packets ?? []).length,
          scanned_flows: (flows ?? []).length,
          by_protocol: summarize(byProtocol),
          by_service: summarize(byService),
        };
      },
    }),

    dns_analysis: tool({
      description:
        "Analyze dissected DNS traffic (packet_records.app_protocol = 'DNS', extra keys 'dns.qry.name', 'dns.rcode', 'dns.label_entropy'): top queried names, NXDOMAIN rate, longest/high-entropy names, top resolvers, and tunneling candidates. Prefer this over packet_search for DNS questions.",
      inputSchema: z.object({
        limit: z.number().nullable(),
      }),
      execute: async (input) => {
        const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
        const { data, error } = await supabase
          .from("packet_records")
          .select("id, ts, src_ip, dst_ip, extra, risk_tags")
          .eq("dataset_id", datasetId)
          .eq("app_protocol", "DNS")
          .limit(MAX_SCAN);
        if (error) throw new Error(error.message);
        const rows = data ?? [];

        const names = new Map<string, number>();
        const resolvers = new Map<string, number>();
        let nxdomain = 0;
        let withRcode = 0;
        const highEntropy: { id: number; name: string; entropy: number; src: string | null; dst: string | null }[] = [];
        const tunnelCandidates: { id: number; name: string | null; src: string | null; dst: string | null }[] = [];

        for (const row of rows) {
          const extra = (row.extra ?? {}) as Record<string, unknown>;
          const name = typeof extra["dns.qry.name"] === "string" ? (extra["dns.qry.name"] as string) : null;
          const rcode = typeof extra["dns.rcode"] === "string" ? (extra["dns.rcode"] as string) : null;
          const entropy = typeof extra["dns.label_entropy"] === "string" ? Number(extra["dns.label_entropy"]) : null;
          const tunnel = extra["dns.tunnel_candidate"] === "true";

          if (name) names.set(name, (names.get(name) ?? 0) + 1);
          if (row.dst_ip) resolvers.set(row.dst_ip, (resolvers.get(row.dst_ip) ?? 0) + 1);
          if (rcode) {
            withRcode += 1;
            if (rcode === "NXDOMAIN") nxdomain += 1;
          }
          if (entropy !== null && Number.isFinite(entropy)) {
            highEntropy.push({ id: row.id, name: name ?? "", entropy, src: row.src_ip, dst: row.dst_ip });
          }
          if (tunnel || (name && name.length > 60)) {
            tunnelCandidates.push({ id: row.id, name, src: row.src_ip, dst: row.dst_ip });
          }
        }

        return {
          scanned_dns_records: rows.length,
          top_queried_names: [...names.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([name, count]) => ({ name, count })),
          nxdomain_rate: withRcode ? Number((nxdomain / withRcode).toFixed(3)) : null,
          nxdomain_count: nxdomain,
          longest_high_entropy_names: highEntropy
            .sort((a, b) => b.entropy - a.entropy || b.name.length - a.name.length)
            .slice(0, limit)
            .map((entry) => ({ evidence_packet_id: entry.id, name: entry.name, entropy: entry.entropy, src: entry.src, dst: entry.dst })),
          top_resolvers: [...resolvers.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([ip, count]) => ({ ip, queries: count })),
          tunneling_candidates: tunnelCandidates.slice(0, limit).map((entry) => ({
            evidence_packet_id: entry.id,
            name: entry.name,
            src: entry.src,
            dst: entry.dst,
          })),
        };
      },
    }),

    tls_inventory: tool({
      description:
        "Inventory dissected TLS traffic (packet_records.app_protocol = 'TLS', extra keys 'tls.sni', 'tls.certificate.cn', 'tls.handshake.version', 'tls.ciphers'): SNI values, certificate CNs, negotiated versions/ciphers and weak-crypto counts. Prefer this over packet_search for TLS/certificate questions.",
      inputSchema: z.object({
        limit: z.number().nullable(),
      }),
      execute: async (input) => {
        const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
        const { data, error } = await supabase
          .from("packet_records")
          .select("id, src_ip, dst_ip, extra, risk_tags")
          .eq("dataset_id", datasetId)
          .eq("app_protocol", "TLS")
          .limit(MAX_SCAN);
        if (error) throw new Error(error.message);
        const rows = data ?? [];

        const sniCounts = new Map<string, number>();
        const cnCounts = new Map<string, number>();
        const versionCounts = new Map<string, number>();
        const cipherCounts = new Map<string, number>();
        let weakCrypto = 0;

        for (const row of rows) {
          const extra = (row.extra ?? {}) as Record<string, unknown>;
          const sni = typeof extra["tls.sni"] === "string" ? (extra["tls.sni"] as string) : null;
          const cn = typeof extra["tls.certificate.cn"] === "string" ? (extra["tls.certificate.cn"] as string) : null;
          const version = typeof extra["tls.handshake.version"] === "string" ? (extra["tls.handshake.version"] as string) : null;
          const ciphers = typeof extra["tls.ciphers"] === "string" ? (extra["tls.ciphers"] as string) : null;
          if (sni) sniCounts.set(sni, (sniCounts.get(sni) ?? 0) + 1);
          if (cn) cnCounts.set(cn, (cnCounts.get(cn) ?? 0) + 1);
          if (version) versionCounts.set(version, (versionCounts.get(version) ?? 0) + 1);
          if (ciphers) {
            for (const cipher of ciphers.split(",").filter(Boolean)) {
              cipherCounts.set(cipher, (cipherCounts.get(cipher) ?? 0) + 1);
            }
          }
          if ((row.risk_tags ?? []).includes("weak-crypto")) weakCrypto += 1;
        }

        const rank = (map: Map<string, number>) =>
          [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value, count]) => ({ value, count }));

        return {
          scanned_tls_records: rows.length,
          sni_values: rank(sniCounts),
          certificate_cns: rank(cnCounts),
          negotiated_versions: rank(versionCounts),
          negotiated_ciphers: rank(cipherCounts),
          weak_crypto_record_count: weakCrypto,
        };
      },
    }),

    risk_exposure: tool({
      description:
        "Aggregate the risk_tags applied by protocol dissection across packet_records and flow_records for this dataset: how many records carry each tag, example endpoints, and the analyst explanation for the tag. Use this to prioritize what to investigate.",
      inputSchema: z.object({
        limit: z.number().nullable(),
      }),
      execute: async (input) => {
        const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
        const [{ data: packets, error: packetError }, { data: flows, error: flowError }] = await Promise.all([
          supabase
            .from("packet_records")
            .select("id, src_ip, dst_ip, src_port, dst_port, service, risk_tags")
            .eq("dataset_id", datasetId)
            .limit(MAX_SCAN),
          supabase
            .from("flow_records")
            .select("id, src_ip, dst_ip, src_port, dst_port, service, risk_tags")
            .eq("dataset_id", datasetId)
            .limit(MAX_SCAN),
        ]);
        if (packetError) throw new Error(packetError.message);
        if (flowError) throw new Error(flowError.message);

        type TagBucket = { count: number; examples: { table: "packet" | "flow"; id: number; src: string | null; dst: string | null; service: string | null }[] };
        const tags = new Map<string, TagBucket>();

        const addRows = (
          rows: { id: number; src_ip: string | null; dst_ip: string | null; src_port: number | null; dst_port: number | null; service: string | null; risk_tags: string[] }[],
          table: "packet" | "flow",
        ) => {
          for (const row of rows) {
            for (const tag of row.risk_tags ?? []) {
              const bucket = tags.get(tag) ?? { count: 0, examples: [] };
              bucket.count += 1;
              if (bucket.examples.length < 5) {
                bucket.examples.push({
                  table,
                  id: row.id,
                  src: row.src_ip ? `${row.src_ip}${row.src_port ? `:${row.src_port}` : ""}` : null,
                  dst: row.dst_ip ? `${row.dst_ip}${row.dst_port ? `:${row.dst_port}` : ""}` : null,
                  service: row.service,
                });
              }
              tags.set(tag, bucket);
            }
          }
        };
        addRows(packets ?? [], "packet");
        addRows(flows ?? [], "flow");

        return {
          scanned_packets: (packets ?? []).length,
          scanned_flows: (flows ?? []).length,
          risk_tags: [...tags.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, limit)
            .map(([tag, bucket]) => ({
              tag,
              record_count: bucket.count,
              explanation: RISK_TAG_NOTES[tag] ?? null,
              example_endpoints: bucket.examples,
            })),
        };
      },
    }),

    credential_exposure: tool({
      description:
        "List packet/flow records tagged 'cleartext-credentials' by protocol dissection, grouped by service, with example src/dst endpoints and the relevant decoded fields (e.g. http.authorization, snmp.community, ldap.simple_bind). Never invents values — only returns what dissection stored.",
      inputSchema: z.object({
        limit: z.number().nullable(),
      }),
      execute: async (input) => {
        const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
        const [{ data: packets, error: packetError }, { data: flows, error: flowError }] = await Promise.all([
          supabase
            .from("packet_records")
            .select("id, ts, src_ip, dst_ip, src_port, dst_port, service, extra, risk_tags")
            .eq("dataset_id", datasetId)
            .contains("risk_tags", ["cleartext-credentials"])
            .limit(limit),
          supabase
            .from("flow_records")
            .select("id, ts, src_ip, dst_ip, src_port, dst_port, service, extra, risk_tags")
            .eq("dataset_id", datasetId)
            .contains("risk_tags", ["cleartext-credentials"])
            .limit(limit),
        ]);
        if (packetError) throw new Error(packetError.message);
        if (flowError) throw new Error(flowError.message);

        const relevantKeys = [
          "http.authorization",
          "http.host",
          "snmp.community",
          "ldap.simple_bind",
          "ldap.base_dn",
          "ldap.dn",
        ];

        const byService = new Map<
          string,
          { table: "packet" | "flow"; id: number; ts: string | null; src: string | null; dst: string | null; fields: Record<string, unknown> }[]
        >();

        const addRows = (
          rows: { id: number; ts: string | null; src_ip: string | null; dst_ip: string | null; src_port: number | null; dst_port: number | null; service: string | null; extra: unknown }[],
          table: "packet" | "flow",
        ) => {
          for (const row of rows) {
            const service = row.service ?? "unknown";
            const extra = (row.extra ?? {}) as Record<string, unknown>;
            const fields: Record<string, unknown> = {};
            for (const key of relevantKeys) if (key in extra) fields[key] = extra[key];
            const list = byService.get(service) ?? [];
            list.push({
              table,
              id: row.id,
              ts: row.ts,
              src: row.src_ip ? `${row.src_ip}${row.src_port ? `:${row.src_port}` : ""}` : null,
              dst: row.dst_ip ? `${row.dst_ip}${row.dst_port ? `:${row.dst_port}` : ""}` : null,
              fields,
            });
            byService.set(service, list);
          }
        };
        addRows(packets ?? [], "packet");
        addRows(flows ?? [], "flow");

        return {
          total_records: (packets ?? []).length + (flows ?? []).length,
          by_service: [...byService.entries()].map(([service, examples]) => ({
            service,
            record_count: examples.length,
            examples: examples.slice(0, 10),
          })),
        };
      },
    }),

    retention_status: tool({
      description:
        "Report the retention posture for the active dataset: the raw-packet window, the metadata (1-minute rollup) window, the hourly-summary window, whether the dataset is pinned, and how many rows of each fidelity remain. Call this before answering questions about older time periods so you can state whether packet-exact detail still exists or has been rolled up/overwritten.",
      inputSchema: z.object({}),
      execute: async () => {
        const { describeRetention } = await import("./retention.server");
        return describeRetention(supabase, datasetId);
      },
    }),

    interface_utilization: tool({
      description:
        "Read live interface counters collected by the NetTAP collector appliance on the monitored LAN. Returns, per interface, average and peak receive/transmit throughput (bits per second), packet rates, error and discard counts, and utilization percent against link speed over the requested window. Use this for 'how busy is my WiFi/uplink', congestion, error-rate and saturation questions — it is host/SNMP counter truth, independent of what capture happened to see.",
      inputSchema: z.object({
        interface_name: z.string().nullish(),
        minutes: z.number().nullish(),
      }),
      execute: async ({ interface_name, minutes }) => {
        const window = Math.min(Math.max(Math.round(minutes ?? 15), 1), 1440);
        const since = new Date(Date.now() - window * 60_000).toISOString();
        let query = supabase
          .from("interface_metrics")
          .select(
            "interface_name, bucket_ts, rx_bytes, tx_bytes, rx_packets, tx_packets, errors, discards, utilization_pct, source",
          )
          .gte("bucket_ts", since)
          .order("bucket_ts", { ascending: false })
          .limit(MAX_SCAN);
        if (interface_name) query = query.eq("interface_name", interface_name);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        if (!rows.length) {
          return {
            window_minutes: window,
            interfaces: [],
            note: "No interface counters in this window. Either no collector appliance is paired and checked in, or interface metric push is disabled in its configuration.",
          };
        }

        const { data: ifaces } = await supabase
          .from("collector_interfaces")
          .select("name, description, link_speed_bps, is_up, capture_enabled");
        const speedByName = new Map(
          (ifaces ?? []).map((row) => [row.name, row] as const),
        );

        const groups = new Map<string, typeof rows>();
        for (const row of rows) {
          const bucket = groups.get(row.interface_name);
          if (bucket) bucket.push(row);
          else groups.set(row.interface_name, [row]);
        }

        const seconds = 10;
        const interfaces = [...groups.entries()].map(([name, samples]) => {
          const rx = samples.map((s) => (Number(s.rx_bytes ?? 0) * 8) / seconds);
          const tx = samples.map((s) => (Number(s.tx_bytes ?? 0) * 8) / seconds);
          const util = samples
            .map((s) => (s.utilization_pct === null ? null : Number(s.utilization_pct)))
            .filter((value): value is number => value !== null);
          const avg = (values: number[]) =>
            values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
          const meta = speedByName.get(name);
          return {
            interface_name: name,
            description: meta?.description ?? null,
            link_speed_bps: meta?.link_speed_bps ?? null,
            is_up: meta?.is_up ?? null,
            capture_enabled: meta?.capture_enabled ?? null,
            source: samples[0]?.source ?? "host",
            samples: samples.length,
            avg_rx_bps: Math.round(avg(rx)),
            peak_rx_bps: Math.round(Math.max(...rx)),
            avg_tx_bps: Math.round(avg(tx)),
            peak_tx_bps: Math.round(Math.max(...tx)),
            avg_pps: Math.round(
              avg(samples.map((s) => (Number(s.rx_packets ?? 0) + Number(s.tx_packets ?? 0)) / seconds)),
            ),
            errors: samples.reduce((sum, s) => sum + Number(s.errors ?? 0), 0),
            discards: samples.reduce((sum, s) => sum + Number(s.discards ?? 0), 0),
            avg_utilization_pct: util.length ? Number(avg(util).toFixed(2)) : null,
            peak_utilization_pct: util.length ? Number(Math.max(...util).toFixed(2)) : null,
          };
        });

        return { window_minutes: window, interfaces };
      },
    }),

    capacity_status: tool({
      description:
        "Report the ingestion capacity posture of the NetTAP appliances: active sizing profile, configured ceilings (flows/s, packets/s, raw-packet hours, database budget), measured flow/packet rates, queue depth, spool and database size, and the active shed stage. Call this whenever the user asks why fidelity is reduced, whether data was dropped or sampled, how much headroom is left, or how long the disk budget lasts — and state the shed stage plainly before concluding that traffic did not happen.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase
          .from("collectors")
          .select("name, os, status, hostname, last_seen_at, config, stats");
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        if (!rows.length) {
          return {
            appliances: [],
            note: "No collector appliance is paired, so ingestion capacity is the browser import path only: files are decoded in the user's tab under the configured import limits, and there is no live capture or flow reception.",
          };
        }

        const { normalizeConfig } = await import("./collector-types");
        const { normalizeLimits, projectRunwayHours, projectDailyBytes, SHED_STAGE_DETAIL } =
          await import("./capacity");

        const appliances = rows.map((row) => {
          const limits = normalizeLimits(normalizeConfig(row.config).capacity);
          const stats = (row.stats ?? {}) as {
            flows_per_second?: number;
            packets_per_second?: number;
            queue_depth?: number;
            dropped_total?: number;
            local_bytes?: number;
            capacity?: {
              shed_stage?: string;
              shed_reason?: string | null;
              spool_bytes?: number;
              db_bytes?: number;
              db_write_lag_ms?: number;
              host?: { vcpu: number; ram_gb: number; disk_total_gb: number; disk_free_gb: number } | null;
            };
          };
          const runtime = stats.capacity ?? {};
          const stage = (runtime.shed_stage ?? "full") as keyof typeof SHED_STAGE_DETAIL;
          const projected = projectDailyBytes(limits);
          const flows = Number(stats.flows_per_second ?? 0);
          const packets = Number(stats.packets_per_second ?? 0);
          return {
            appliance: row.name,
            os: row.os,
            status: row.status,
            hostname: row.hostname,
            last_seen_at: row.last_seen_at,
            host_resources: runtime.host ?? null,
            profile: limits.profile,
            ceilings: {
              flows_per_second: limits.max_flows_per_second,
              packets_per_second: limits.max_packets_per_second,
              raw_packet_hours: limits.raw_packet_hours,
              flow_metadata_days: limits.flow_metadata_days,
              summary_days: limits.summary_days,
              local_max_gb: limits.local_max_gb,
              dissect_depth: limits.dissect_depth,
              max_import_bytes: limits.max_import_bytes,
              max_packets_per_import: limits.max_packets_per_import,
            },
            observed: {
              flows_per_second: flows,
              packets_per_second: packets,
              flow_headroom_pct: limits.max_flows_per_second
                ? Number((100 - (flows / limits.max_flows_per_second) * 100).toFixed(1))
                : null,
              packet_headroom_pct: limits.max_packets_per_second
                ? Number((100 - (packets / limits.max_packets_per_second) * 100).toFixed(1))
                : null,
              queue_depth: Number(stats.queue_depth ?? 0),
              dropped_total: Number(stats.dropped_total ?? 0),
              spool_bytes: Number(runtime.spool_bytes ?? 0),
              db_bytes: Number(runtime.db_bytes ?? stats.local_bytes ?? 0),
              db_write_lag_ms: Number(runtime.db_write_lag_ms ?? 0),
            },
            fidelity: { shed_stage: stage, effect: SHED_STAGE_DETAIL[stage] ?? null, reason: runtime.shed_reason ?? null },
            projection: {
              raw_gb_per_day: Number((projected.raw_per_day / 1e9).toFixed(1)),
              compressed_gb_per_day: Number((projected.compressed_per_day / 1e9).toFixed(1)),
              budget_runway_hours: Number(projectRunwayHours(limits).toFixed(1)),
            },
          };
        });

        return {
          appliances,
          note: "Ceilings are configuration, not hardware truth: a shed stage other than 'full' means the appliance deliberately reduced fidelity, so counts in that window are conservative.",
        };
      },
    }),

    network_inventory: tool({

      description:
        "Report the monitored network's collection posture and device inventory gathered by the NetTAP collector appliance: paired appliances and their health, NetFlow/IPFIX/sFlow exporters seen (with template counts, sampling rate and drops), latest ICMP/SNMP/WMI probe results per target, and read-only device facts (system descriptions, interface tables, config 'show' output). Use it to answer 'what is being monitored', reachability/latency questions, and to caveat coverage gaps.",
      inputSchema: z.object({ host: z.string().nullish() }),
      execute: async ({ host }) => {
        const [collectors, exporters, probes, facts] = await Promise.all([
          supabase.from("collectors").select("name, os, status, hostname, last_seen_at, last_error, stats"),
          supabase
            .from("flow_exporters")
            .select("exporter_ip, protocol, version, templates, sampling_rate, flows, packets_dropped, last_seen_at")
            .order("last_seen_at", { ascending: false })
            .limit(50),
          supabase
            .from("probe_results")
            .select("kind, target, metric, value, value_text, unit, status, ts")
            .gte("ts", new Date(Date.now() - 60 * 60_000).toISOString())
            .order("ts", { ascending: false })
            .limit(2000),
          host
            ? supabase
                .from("device_facts")
                .select("host, source, kind, summary, content, collected_at")
                .eq("host", host)
                .order("collected_at", { ascending: false })
                .limit(10)
            : supabase
                .from("device_facts")
                .select("host, source, kind, summary, collected_at")
                .order("collected_at", { ascending: false })
                .limit(30),
        ]);

        const latest = new Map<string, Record<string, unknown>>();
        for (const row of probes.data ?? []) {
          const key = `${row.kind}|${row.target}|${row.metric}`;
          if (!latest.has(key)) latest.set(key, row);
        }

        return {
          collectors: collectors.data ?? [],
          exporters: exporters.data ?? [],
          probes: [...latest.values()],
          device_facts: facts.data ?? [],
          note: (collectors.data ?? []).length
            ? "Appliance telemetry is live: flow/probe coverage is limited to the exporters and targets listed here."
            : "No collector appliance is paired, so there is no live LAN telemetry — answer only from ingested datasets.",
        };
      },
    }),

    history_sql: tool({
      description: HISTORY_SQL_TOOL_DESCRIPTION,
      inputSchema: z.object({
        question: z.string().min(1),
        sql: z.string().min(1),
        max_rows: z.number().int().positive().max(1000).nullish(),
      }),
      execute: async ({ question, sql, max_rows }) =>
        runHistorySql(supabase, { question, sql, max_rows: max_rows ?? null }),
    }),
  };
}

/** Shared description so the AI SDK tool and the raw Ollama schema stay identical. */
export const HISTORY_SQL_TOOL_DESCRIPTION =
  "Answer a history question by writing one read-only SQL query against the retained-telemetry history views, then get back a summary plus the result rows. Use this for time-series and 'over the last N days/hours' questions, custom groupings, rankings and joins that the fixed tools do not cover, and for checking what history still exists before claiming activity did or did not happen. The query is validated and capped, and only ever sees the current user's data.\n\n" +
  HISTORY_SCHEMA_DOC;

/**
 * Validate the model's SQL, execute it through the guarded `history_query`
 * database function, and return a summary alongside the rows.
 */
export async function runHistorySql(
  supabase: Client,
  input: { question: string; sql: string; max_rows?: number | null },
) {
  const maxRows = Math.min(Math.max(input.max_rows ?? 200, 1), 1000);
  const validation = validateHistorySql(input.sql);
  if (!validation.ok) {
    return {
      ok: false as const,
      question: input.question,
      sql: input.sql,
      error: validation.error,
      hint: "Rewrite the query as a single read-only SELECT/WITH over the history views, then call history_sql again.",
      allowed_views: HISTORY_VIEWS,
    };
  }

  const { data, error } = await supabase.rpc("history_query", {
    p_sql: validation.sql,
    p_max_rows: maxRows,
  });

  if (error) {
    return {
      ok: false as const,
      question: input.question,
      sql: validation.sql,
      error: error.message,
      hint: "The database rejected this query. Fix the SQL (columns, casts, allowed views) and retry once; do not repeat an identical failing query.",
      allowed_views: HISTORY_VIEWS,
    };
  }

  const payload = (data ?? {}) as { rows?: HistoryRow[]; row_count?: number; max_rows?: number };
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const summary = summarizeHistoryRows(rows, payload.max_rows ?? maxRows);

  return {
    ok: true as const,
    question: input.question,
    sql: validation.sql,
    summary,
    // Keep the evidence payload small enough for the model's context window.
    rows: rows.slice(0, 100),
    rows_omitted: Math.max(rows.length - 100, 0),
    note:
      summary.row_count === 0
        ? "No rows matched. Check history_coverage before concluding the activity did not happen — the window may predate what is still retained."
        : "Rows come from retained history; state which fidelity tier(s) the numbers came from when tier is present.",
  };
}

