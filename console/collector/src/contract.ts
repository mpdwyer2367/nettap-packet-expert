/**
 * Mirror of /dev-server/src/lib/collector-types.ts, kept in sync by hand.
 * This file exists so the collector appliance can compile standalone,
 * without importing anything from the console app's src/ tree.
 *
 * DO NOT let this drift silently: any change to the console's
 * collector-types.ts wire contract must be copied here too.
 */

import type { CapacityLimits, CapacityRuntime } from "./capacity.js";
import { DEFAULT_CAPACITY_LIMITS, normalizeLimits } from "./capacity.js";

export type CollectorOs = "linux" | "windows" | "macos";

export const COLLECTOR_OS_LABELS: Record<CollectorOs, string> = {
  linux: "Linux (systemd)",
  windows: "Windows (service)",
  macos: "macOS (launchd)",
};

export type CollectorStatus = "pending" | "online" | "stale" | "error" | "disabled";

export const COLLECTOR_STALE_SECONDS = 120;
export const HEARTBEAT_SECONDS = 20;
export const METRIC_BUCKET_SECONDS = 10;
export const MAX_UPLINK_BYTES = 4_000_000;

export type CaptureInputConfig = {
  interface_name: string;
  enabled: boolean;
  filter: string;
  slice_seconds: number;
  promiscuous: boolean;
  vantage: string;
  observation_point: string;
  push_packets: boolean;
};

export type FlowReceiverConfig = {
  protocol: "netflow" | "ipfix" | "sflow";
  enabled: boolean;
  port: number;
  bind_address: string;
  allow_exporters: string[];
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
  community?: string;
  username?: string;
  auth_protocol?: "md5" | "sha";
  auth_key?: string;
  priv_protocol?: "des" | "aes";
  priv_key?: string;
  interval_seconds: number;
  poll_interfaces: boolean;
  oids: { oid: string; metric: string; unit?: string }[];
};

export type WmiTargetConfig = {
  target: string;
  enabled: boolean;
  username?: string;
  password?: string;
  port: number;
  use_https: boolean;
  interval_seconds: number;
  queries: { name: string; wql: string }[];
};

export type DeviceReadConfig = {
  host: string;
  enabled: boolean;
  source: "snmp" | "ssh";
  interval_minutes: number;
  username?: string;
  password?: string;
  commands: string[];
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
  push_rollups: boolean;
  push_interface_metrics: boolean;
  push_probes: boolean;
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
  api: { port: number; bind_address: string };
  capacity: CapacityLimits;
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
  uplink: {
    push_rollups: true,
    push_interface_metrics: true,
    push_probes: true,
    push_device_facts: true,
    batch_seconds: 30,
  },
  api: { port: 8787, bind_address: "127.0.0.1" },
  capacity: DEFAULT_CAPACITY_LIMITS,
};

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
  config: CollectorConfig | null;
  dataset_id: string | null;
};

export type UplinkRequest = {
  interface_metrics?: ReportedInterfaceMetric[];
  flow_rollups?: ReportedFlowRollup[];
  exporters?: ReportedExporter[];
  probes?: ReportedProbe[];
  device_facts?: ReportedDeviceFact[];
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
    api: { ...DEFAULT_COLLECTOR_CONFIG.api, ...(raw.api ?? {}) },
    capacity: normalizeLimits(raw.capacity),
  };
}
