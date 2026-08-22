/**
 * Client-safe normalized contract for the MATRIX read-only telemetry
 * integration. No node built-ins, no secrets — safe to import from routes.
 */

export type MatrixMode = "simulator" | "live";

export type MatrixConnectionStatus = "pending" | "online" | "error" | "disabled";

export type MatrixConnectionSummary = {
  id: string;
  name: string;
  site: string;
  mode: MatrixMode;
  base_url: string | null;
  secret_name: string | null;
  verify_tls: boolean;
  poll_interval_seconds: number;
  status: string;
  last_error: string | null;
  last_polled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MatrixDeviceRole =
  | "spine"
  | "leaf"
  | "broker"
  | "tool"
  | "tap"
  | "router"
  | "firewall"
  | "unknown";

export type MatrixHealthStatus = "healthy" | "degraded" | "critical" | "unknown";

export type MatrixDevice = {
  id: string;
  connection_id: string;
  device_key: string;
  name: string;
  site: string | null;
  role: string;
  model: string | null;
  serial: string | null;
  os_version: string | null;
  mgmt_ip: string | null;
  health_status: string;
  health: Record<string, unknown>;
  p4_state: Record<string, unknown>;
  last_seen_at: string;
};

export type MatrixPortKind = "access" | "uplink" | "tap" | "span" | "tool" | "fabric" | "unknown";

export type MatrixPort = {
  id: string;
  connection_id: string;
  device_id: string;
  port_key: string;
  name: string;
  kind: string;
  speed_bps: number | null;
  admin_state: string;
  oper_state: string;
  media: string | null;
  description: string | null;
  extra: Record<string, unknown>;
};

export type MatrixLink = {
  id: string;
  connection_id: string;
  src_port_id: string | null;
  dst_port_id: string | null;
  link_key: string;
  kind: string;
  status: string;
  extra: Record<string, unknown>;
};

export type MatrixAlarmSeverity = "critical" | "major" | "minor" | "warning" | "info";

export type MatrixAlarm = {
  id: string;
  connection_id: string;
  alarm_key: string;
  device_key: string | null;
  port_key: string | null;
  severity: string;
  state: string;
  category: string | null;
  message: string;
  raised_at: string;
  cleared_at: string | null;
  extra: Record<string, unknown>;
};

export type MatrixPolicy = {
  id: string;
  connection_id: string;
  policy_key: string;
  name: string;
  device_key: string | null;
  enabled: boolean;
  priority: number;
  ingress_ports: string[];
  egress_ports: string[];
  actions: Record<string, unknown>;
  match_rules: Record<string, unknown>;
  revision: number;
};

export type MatrixConfigRevision = {
  id: string;
  connection_id: string;
  revision: number;
  author: string | null;
  summary: string | null;
  snapshot: Record<string, unknown>;
  captured_at: string;
};

export type MatrixPortCounterSample = {
  port_id: string;
  bucket_ts: string;
  rx_bytes: number;
  tx_bytes: number;
  rx_packets: number;
  tx_packets: number;
  errors: number;
  discards: number;
  crc_errors: number;
  utilization_pct: number | null;
};

/** Everything the adapter returns for a single poll cycle. */
export type MatrixSnapshot = {
  devices: MatrixDevice[];
  ports: MatrixPort[];
  links: MatrixLink[];
  alarms: MatrixAlarm[];
  policies: MatrixPolicy[];
  configRevision: MatrixConfigRevision | null;
  counters: MatrixPortCounterSample[];
};

export type MatrixTopologyNode = {
  id: string;
  kind: "device" | "port";
  label: string;
  site: string | null;
  role?: string;
  health?: string;
  parentId?: string | null;
  data: MatrixDevice | MatrixPort;
};

export type MatrixTopologyEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
  status: string;
};

export type MatrixTopology = {
  nodes: MatrixTopologyNode[];
  edges: MatrixTopologyEdge[];
  devices: MatrixDevice[];
  ports: MatrixPort[];
  links: MatrixLink[];
};

export type MatrixPolicyDiffEntry = {
  policy_key: string;
  name: string;
  change: "added" | "removed" | "changed";
  before?: Partial<MatrixPolicy> | null;
  after?: Partial<MatrixPolicy> | null;
  fields_changed?: string[];
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  major: 1,
  minor: 2,
  warning: 3,
  info: 4,
};

export function severityRank(severity: string | null | undefined) {
  return SEVERITY_ORDER[(severity ?? "info").toLowerCase()] ?? 9;
}

export function compareSeverity(a: string | null | undefined, b: string | null | undefined) {
  return severityRank(a) - severityRank(b);
}

export function formatUtilization(pct: number | null | undefined) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return "—";
  return `${pct.toFixed(1)}%`;
}

export function formatSpeed(bps: number | null | undefined) {
  if (!bps) return "—";
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(bps % 1_000_000_000 === 0 ? 0 : 1)}G`;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(0)}M`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)}K`;
  return `${bps}`;
}

export const PORT_ROLE_LABELS: Record<string, string> = {
  access: "Access",
  uplink: "Uplink",
  tap: "TAP",
  span: "SPAN",
  tool: "Tool port",
  fabric: "Fabric",
  unknown: "Unknown",
};

export function portRoleLabel(kind: string | null | undefined) {
  return PORT_ROLE_LABELS[(kind ?? "unknown").toLowerCase()] ?? kind ?? "Unknown";
}

export const HEALTH_TONE: Record<string, string> = {
  healthy: "text-primary",
  degraded: "text-amber-500",
  critical: "text-destructive",
  unknown: "text-muted-foreground",
};

export function healthTone(status: string | null | undefined) {
  return HEALTH_TONE[(status ?? "unknown").toLowerCase()] ?? HEALTH_TONE.unknown;
}
