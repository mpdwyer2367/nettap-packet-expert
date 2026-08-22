/**
 * Shared contract between the NetTAP console (this app) and the collector
 * appliance that runs on your VM.
 *
 * The appliance owns the live network: it enumerates interfaces, receives
 * NetFlow/IPFIX/sFlow on UDP, captures packets through dumpcap/tshark, polls
 * SNMP/WMI, runs ICMP probes, and keeps raw records in a local Postgres. The
 * console stores configuration, rollups and health so chat and reports can
 * reason over them.
 *
 * Everything in this file is client-safe: no node built-ins, no secrets.
 */

import { DEFAULT_CAPACITY_LIMITS, normalizeLimits } from "./capacity";
import type { CapacityLimits, CapacityRuntime } from "./capacity";

export type CollectorOs = "linux" | "windows" | "macos";

export const COLLECTOR_OS_LABELS: Record<CollectorOs, string> = {
  linux: "Linux (systemd)",
  windows: "Windows (service)",
  macos: "macOS (launchd)",
};

export type CollectorStatus = "pending" | "online" | "stale" | "error" | "disabled";

export const COLLECTOR_STATUS_LABELS: Record<CollectorStatus, string> = {
  pending: "Waiting for first check-in",
  online: "Online",
  stale: "No recent check-in",
  error: "Reporting errors",
  disabled: "Disabled",
};

/** An appliance is considered stale once it misses this many seconds. */
export const COLLECTOR_STALE_SECONDS = 120;

/** Heartbeat cadence the appliance should use (seconds). */
export const HEARTBEAT_SECONDS = 20;

/** Interface counter resolution pushed by the appliance (seconds). */
export const METRIC_BUCKET_SECONDS = 10;

/** Hard cap on a single uplink body so a busy appliance cannot wedge the API. */
export const MAX_UPLINK_BYTES = 4_000_000;

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

export type CaptureInputConfig = {
  interface_name: string;
  enabled: boolean;
  /** libpcap/BPF capture filter, e.g. `not port 22`. */
  filter: string;
  /** Rotate a capture slice every N seconds before decoding. */
  slice_seconds: number;
  promiscuous: boolean;
  /** Capture vantage — drives the blind-spot caveats the model must state. */
  vantage: string;
  observation_point: string;
  /** Upload dissected packet metadata to the console, not just rollups. */
  push_packets: boolean;
};

export type FlowReceiverConfig = {
  protocol: "netflow" | "ipfix" | "sflow";
  enabled: boolean;
  port: number;
  bind_address: string;
  /** Empty list accepts every exporter; otherwise an IP allowlist. */
  allow_exporters: string[];
  /** Override the sampling rate when an exporter reports none. */
  sampling_rate: number | null;
  vantage: string;
  observation_point: string;
};

export type IcmpTargetConfig = {
  target: string;
  enabled: boolean;
  interval_seconds: number;
  count: number;
  timeout_ms: number;
};

export type SnmpTargetConfig = {
  target: string;
  enabled: boolean;
  version: "2c" | "3";
  /** v2c community; stored on the appliance only. */
  community?: string;
  /** v3 credentials; stored on the appliance only. */
  username?: string;
  auth_protocol?: "md5" | "sha";
  auth_key?: string;
  priv_protocol?: "des" | "aes";
  priv_key?: string;
  interval_seconds: number;
  /** Poll the standard interface table for utilization. */
  poll_interfaces: boolean;
  /** Extra scalar OIDs to sample each interval. */
  oids: { oid: string; metric: string; unit?: string }[];
};

export type WmiTargetConfig = {
  target: string;
  enabled: boolean;
  username?: string;
  password?: string;
  /** WinRM transport port; 5985 http, 5986 https. */
  port: number;
  use_https: boolean;
  interval_seconds: number;
  queries: { name: string; wql: string }[];
};

export type DeviceReadConfig = {
  host: string;
  enabled: boolean;
  /** Read-only pulls: SNMP walks or SSH `show` commands. Never writes. */
  source: "snmp" | "ssh";
  interval_minutes: number;
  /** SSH access; appliance-local only. */
  username?: string;
  password?: string;
  /** SSH commands must be read-only; the appliance rejects anything else. */
  commands: string[];
  /** SNMP walk roots (system, ifTable, entity MIB, …). */
  walks: string[];
};

export type BrokerSourceConfig = {
  enabled: boolean;
  name: string;
  base_url: string;
  resource: string;
  interval_seconds: number;
  auth_header?: string;
  token?: string;
};

export type RetentionConfig = {
  raw_hours: number;
  metadata_days: number;
  local_max_gb: number;
};

export type UplinkConfig = {
  /** Push minute rollups to the console. */
  push_rollups: boolean;
  /** Push interface counters for the utilization charts. */
  push_interface_metrics: boolean;
  /** Push probe results (ICMP/SNMP/WMI). */
  push_probes: boolean;
  /** Push read-only device facts. */
  push_device_facts: boolean;
  batch_seconds: number;
};

export type CollectorConfig = {
  captures: CaptureInputConfig[];
  flow_receivers: FlowReceiverConfig[];
  icmp: IcmpTargetConfig[];
  snmp: SnmpTargetConfig[];
  wmi: WmiTargetConfig[];
  devices: DeviceReadConfig[];
  broker: BrokerSourceConfig | null;
  retention: RetentionConfig;
  uplink: UplinkConfig;
  /**
   * Ingestion ceilings. Every capture/flow/import limit lives here so throughput
   * scales with the VM instead of being pinned by a constant in code.
   */
  capacity: CapacityLimits;
  /** Local HTTP API the console proxies drill-down queries through. */
  api: { port: number; bind_address: string };
};


export const DEFAULT_COLLECTOR_CONFIG: CollectorConfig = {
  captures: [],
  flow_receivers: [
    {
      protocol: "netflow",
      enabled: true,
      port: 2055,
      bind_address: "0.0.0.0",
      allow_exporters: [],
      sampling_rate: null,
      vantage: "flow_export",
      observation_point: "NetFlow exporters",
    },
    {
      protocol: "ipfix",
      enabled: true,
      port: 4739,
      bind_address: "0.0.0.0",
      allow_exporters: [],
      sampling_rate: null,
      vantage: "flow_export",
      observation_point: "IPFIX exporters",
    },
    {
      protocol: "sflow",
      enabled: false,
      port: 6343,
      bind_address: "0.0.0.0",
      allow_exporters: [],
      sampling_rate: null,
      vantage: "flow_export",
      observation_point: "sFlow agents",
    },
  ],
  icmp: [],
  snmp: [],
  wmi: [],
  devices: [],
  broker: null,
  retention: { raw_hours: 24, metadata_days: 7, local_max_gb: 50 },
  capacity: DEFAULT_CAPACITY_LIMITS,
  uplink: {
    push_rollups: true,
    push_interface_metrics: true,
    push_probes: true,
    push_device_facts: true,
    batch_seconds: 30,
  },
  api: { port: 8787, bind_address: "127.0.0.1" },
};

/* -------------------------------------------------------------------------- */
/* Uplink payloads                                                            */
/* -------------------------------------------------------------------------- */

export type ReportedInterface = {
  name: string;
  description?: string | null;
  mac?: string | null;
  addresses: string[];
  link_speed_bps?: number | null;
  is_up: boolean;
  is_loopback: boolean;
};

export type ReportedInterfaceMetric = {
  interface_name: string;
  bucket_ts: string;
  rx_bytes: number;
  tx_bytes: number;
  rx_packets: number;
  tx_packets: number;
  errors: number;
  discards: number;
  utilization_pct: number | null;
  source: "host" | "snmp" | "capture";
};

export type ReportedFlowRollup = {
  bucket_ts: string;
  src_ip: string | null;
  dst_ip: string | null;
  src_port: number | null;
  dst_port: number | null;
  protocol: string | null;
  app_protocol?: string | null;
  service?: string | null;
  packets: number;
  bytes: number;
  flow_count: number;
  risk_tags?: string[];
  vantage?: string;
};

export type ReportedExporter = {
  exporter_ip: string;
  protocol: string;
  version?: string | null;
  templates: number;
  sampling_rate?: number | null;
  flows: number;
  packets_dropped: number;
};

export type ReportedProbe = {
  kind: "icmp" | "snmp" | "wmi";
  target: string;
  metric: string;
  value?: number | null;
  value_text?: string | null;
  unit?: string | null;
  status: string;
  ts: string;
  extra?: Record<string, unknown>;
};

export type ReportedDeviceFact = {
  host: string;
  source: "snmp" | "ssh";
  kind: string;
  summary?: string | null;
  content: string;
  extra?: Record<string, unknown>;
  collected_at: string;
};

export type CollectorStats = {
  uptime_seconds?: number;
  flows_per_second?: number;
  packets_per_second?: number;
  flows_total?: number;
  packets_total?: number;
  dropped_total?: number;
  local_bytes?: number;
  queue_depth?: number;
  inputs?: { name: string; status: string; detail?: string }[];
  /** Live capacity pressure, shed stage and detected VM resources. */
  capacity?: CapacityRuntime;
};

export type HeartbeatRequest = {
  version: string;
  hostname: string;
  os: CollectorOs;
  applied_revision: number;
  stats: CollectorStats;
  interfaces?: ReportedInterface[];
  events?: { level: string; kind: string; message: string }[];
};

export type HeartbeatResponse = {
  ok: true;
  collector_id: string;
  config_revision: number;
  /** Present when the appliance is behind the console revision. */
  config: CollectorConfig | null;
  dataset_id: string | null;
};

export type UplinkRequest = {
  interface_metrics?: ReportedInterfaceMetric[];
  flow_rollups?: ReportedFlowRollup[];
  exporters?: ReportedExporter[];
  probes?: ReportedProbe[];
  device_facts?: ReportedDeviceFact[];
  /** tshark EK NDJSON for full packet metadata (optional, capped by size). */
  packets_ek?: string;
};

export type UplinkResponse = {
  ok: true;
  accepted: {
    interface_metrics: number;
    flow_rollups: number;
    exporters: number;
    probes: number;
    device_facts: number;
    packets: number;
  };
};

/* -------------------------------------------------------------------------- */
/* Console-side view models                                                   */
/* -------------------------------------------------------------------------- */

export type CollectorRow = {
  id: string;
  name: string;
  os: CollectorOs;
  version: string | null;
  hostname: string | null;
  status: CollectorStatus;
  last_seen_at: string | null;
  last_error: string | null;
  dataset_id: string | null;
  config: CollectorConfig;
  config_revision: number;
  applied_revision: number;
  stats: CollectorStats;
  created_at: string;
};

export type InterfaceRow = {
  id: string;
  collector_id: string;
  name: string;
  description: string | null;
  mac: string | null;
  addresses: string[];
  link_speed_bps: number | null;
  is_up: boolean;
  is_loopback: boolean;
  capture_enabled: boolean;
  last_seen_at: string;
};

export type MetricPoint = {
  bucket_ts: string;
  rx_bps: number;
  tx_bps: number;
  rx_pps: number;
  tx_pps: number;
  errors: number;
  discards: number;
  utilization_pct: number | null;
};

export type ExporterRow = {
  exporter_ip: string;
  protocol: string;
  version: string | null;
  templates: number;
  sampling_rate: number | null;
  flows: number;
  packets_dropped: number;
  last_seen_at: string;
};

export type ProbeSummaryRow = {
  kind: string;
  target: string;
  metric: string;
  unit: string | null;
  status: string;
  latest: number | null;
  latest_text: string | null;
  avg_value: number | null;
  samples: number;
  ts: string;
};

export type DeviceFactRow = {
  id: string;
  host: string;
  source: string;
  kind: string;
  summary: string | null;
  content: string;
  collected_at: string;
};

export type CollectorEventRow = {
  id: number;
  level: string;
  kind: string;
  message: string;
  created_at: string;
};

export type ApplianceOverview = {
  collectors: CollectorRow[];
  interfaces: InterfaceRow[];
  exporters: ExporterRow[];
  probes: ProbeSummaryRow[];
  device_facts: DeviceFactRow[];
  events: CollectorEventRow[];
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export function collectorStatusFrom(
  lastSeen: string | null,
  lastError: string | null,
): CollectorStatus {
  if (!lastSeen) return "pending";
  const age = (Date.now() - new Date(lastSeen).getTime()) / 1000;
  if (age > COLLECTOR_STALE_SECONDS) return "stale";
  if (lastError) return "error";
  return "online";
}

export function formatBitsPerSecond(bps: number) {
  const units = ["bps", "Kbps", "Mbps", "Gbps", "Tbps"];
  let value = Math.max(0, bps);
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Normalizes an arbitrary jsonb blob into a complete config object. */
export function normalizeConfig(input: unknown): CollectorConfig {
  const raw = (input ?? {}) as Partial<CollectorConfig>;
  return {
    captures: Array.isArray(raw.captures) ? raw.captures : [],
    flow_receivers:
      Array.isArray(raw.flow_receivers) && raw.flow_receivers.length
        ? raw.flow_receivers
        : DEFAULT_COLLECTOR_CONFIG.flow_receivers,
    icmp: Array.isArray(raw.icmp) ? raw.icmp : [],
    snmp: Array.isArray(raw.snmp) ? raw.snmp : [],
    wmi: Array.isArray(raw.wmi) ? raw.wmi : [],
    devices: Array.isArray(raw.devices) ? raw.devices : [],
    broker: raw.broker ?? null,
    retention: { ...DEFAULT_COLLECTOR_CONFIG.retention, ...(raw.retention ?? {}) },
    uplink: { ...DEFAULT_COLLECTOR_CONFIG.uplink, ...(raw.uplink ?? {}) },
    capacity: normalizeLimits(raw.capacity),
    api: { ...DEFAULT_COLLECTOR_CONFIG.api, ...(raw.api ?? {}) },
  };
}

/** Strips appliance-only secrets before a config leaves the server. */
export function redactConfig(config: CollectorConfig): CollectorConfig {
  const MASK = "••••••••";
  const maskKeys = <T extends object>(row: T, keys: (keyof T)[]): T => {
    const next = { ...row };
    for (const key of keys) {
      if (typeof next[key] === "string" && next[key]) next[key] = MASK as T[keyof T];
    }
    return next;
  };
  return {
    ...config,
    snmp: config.snmp.map((t) => maskKeys(t, ["community", "auth_key", "priv_key"])),
    wmi: config.wmi.map((t) => maskKeys(t, ["password"])),
    devices: config.devices.map((d) => maskKeys(d, ["password"])),
    broker: config.broker ? maskKeys(config.broker, ["token"]) : null,
  };
}
