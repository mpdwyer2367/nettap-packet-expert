/**
 * Capacity model shared by the NetTAP console and the collector appliance.
 *
 * Every ingestion ceiling in the platform is configuration, not a constant.
 * A profile provides sane defaults for a given VM shape; each individual limit
 * stays editable and is validated against the resources the appliance actually
 * reports so an operator cannot ask for throughput the hardware cannot honor.
 *
 * Client-safe: no node built-ins, no secrets.
 */

export type CapacityProfileId = "small" | "medium" | "large" | "xl" | "custom";

export type ShedStage = "full" | "no_dissect" | "rollups_only" | "sampled";

/** Order in which fidelity is given up under sustained pressure. */
export const SHED_ORDER: ShedStage[] = ["full", "no_dissect", "rollups_only", "sampled"];

export const SHED_STAGE_LABELS: Record<ShedStage, string> = {
  full: "Full fidelity",
  no_dissect: "Deep dissection paused",
  rollups_only: "Raw packets dropped, rollups kept",
  sampled: "Flow sampling active",
};

export const SHED_STAGE_DETAIL: Record<ShedStage, string> = {
  full: "Every packet is dissected and stored, every flow recorded.",
  no_dissect:
    "Application-layer dissection is skipped; 5-tuple, bytes, packets and timing stay exact.",
  rollups_only:
    "Per-packet rows are discarded. Minute rollups, flows and interface counters remain complete.",
  sampled:
    "Flows are sampled to survive the burst. Counts are statistical estimates until pressure clears.",
};

export type DissectionDepth = "off" | "transport" | "application" | "full";

export const DISSECTION_DEPTH_LABELS: Record<DissectionDepth, string> = {
  off: "Headers only (fastest)",
  transport: "Through TCP/UDP",
  application: "Application protocols (DNS, HTTP, TLS, SMB…)",
  full: "Application + decryption when keys are present",
};

export type CapacityLimits = {
  profile: CapacityProfileId;

  /* ---- Import / file ingestion ---- */
  /** Largest single import file, bytes. 0 means unlimited (bounded by free disk). */
  max_import_bytes: number;
  /** Packet rows persisted per import file. 0 means unlimited. */
  max_packets_per_import: number;
  /** Resumable upload chunk size, bytes. */
  upload_chunk_bytes: number;
  /** Concurrent streaming imports. */
  import_concurrency: number;

  /* ---- Live capture ---- */
  /** dumpcap ring buffer: size of each file, MB. */
  ring_file_mb: number;
  /** dumpcap ring buffer: number of files retained. */
  ring_files: number;
  /** Snap length per packet, bytes. 0 captures the full frame. */
  snaplen_bytes: number;
  /** tshark dissection workers. */
  dissect_workers: number;
  dissect_depth: DissectionDepth;

  /* ---- Flow receivers ---- */
  /** Sustained flow records per second before shedding. */
  max_flows_per_second: number;
  /** Sustained packets per second stored before shedding. */
  max_packets_per_second: number;
  /** UDP receiver workers per flow port (SO_REUSEPORT). */
  receiver_workers: number;
  /** SO_RCVBUF per receiver socket, MB. */
  socket_buffer_mb: number;

  /* ---- Write path ---- */
  /** Rows per COPY batch into local Postgres. */
  copy_batch_rows: number;
  /** Flush interval for partial batches, ms. */
  flush_interval_ms: number;
  /** In-memory queue high-water mark, rows, before spilling to disk spool. */
  queue_high_water: number;
  /** Disk spool ceiling, GB, before the oldest spool segments are dropped. */
  spool_max_gb: number;
  /** Minute-rollup interval, seconds. */
  rollup_seconds: number;

  /* ---- Retention ---- */
  raw_packet_hours: number;
  flow_metadata_days: number;
  summary_days: number;
  /** Total local database ceiling, GB. Retention tightens automatically near it. */
  local_max_gb: number;
  /** Compress Timescale chunks older than this many hours. */
  compress_after_hours: number;
};

export type CapacityProfile = {
  id: Exclude<CapacityProfileId, "custom">;
  label: string;
  blurb: string;
  /** Minimum VM shape this profile expects. */
  requires: { vcpu: number; ram_gb: number; disk_gb: number };
  /** Headline numbers shown in the console. */
  headline: { flows_per_second: number; capture_bps: number };
  limits: Omit<CapacityLimits, "profile">;
};

const MB = 1024 * 1024;

export const CAPACITY_PROFILES: CapacityProfile[] = [
  {
    id: "small",
    label: "Small",
    blurb: "Branch office or lab VM. One interface, modest flow export.",
    requires: { vcpu: 4, ram_gb: 8, disk_gb: 100 },
    headline: { flows_per_second: 5_000, capture_bps: 200_000_000 },
    limits: {
      max_import_bytes: 2 * 1024 * MB,
      max_packets_per_import: 250_000,
      upload_chunk_bytes: 8 * MB,
      import_concurrency: 1,
      ring_file_mb: 256,
      ring_files: 80,
      snaplen_bytes: 262_144,
      dissect_workers: 1,
      dissect_depth: "application",
      max_flows_per_second: 5_000,
      max_packets_per_second: 20_000,
      receiver_workers: 1,
      socket_buffer_mb: 16,
      copy_batch_rows: 5_000,
      flush_interval_ms: 1_000,
      queue_high_water: 100_000,
      spool_max_gb: 5,
      rollup_seconds: 60,
      raw_packet_hours: 6,
      flow_metadata_days: 7,
      summary_days: 90,
      local_max_gb: 60,
      compress_after_hours: 6,
    },
  },
  {
    id: "medium",
    label: "Medium",
    blurb: "Single data-center vantage. 1 Gbps capture with real flow volume.",
    requires: { vcpu: 8, ram_gb: 32, disk_gb: 1_000 },
    headline: { flows_per_second: 50_000, capture_bps: 1_000_000_000 },
    limits: {
      max_import_bytes: 20 * 1024 * MB,
      max_packets_per_import: 5_000_000,
      upload_chunk_bytes: 16 * MB,
      import_concurrency: 2,
      ring_file_mb: 1_024,
      ring_files: 250,
      snaplen_bytes: 262_144,
      dissect_workers: 4,
      dissect_depth: "application",
      max_flows_per_second: 50_000,
      max_packets_per_second: 200_000,
      receiver_workers: 4,
      socket_buffer_mb: 64,
      copy_batch_rows: 20_000,
      flush_interval_ms: 750,
      queue_high_water: 750_000,
      spool_max_gb: 40,
      rollup_seconds: 60,
      raw_packet_hours: 24,
      flow_metadata_days: 7,
      summary_days: 180,
      local_max_gb: 800,
      compress_after_hours: 4,
    },
  },
  {
    id: "large",
    label: "Large",
    blurb: "Aggregated NPB feed, multi-site flow export, 5 Gbps capture.",
    requires: { vcpu: 16, ram_gb: 64, disk_gb: 2_000 },
    headline: { flows_per_second: 120_000, capture_bps: 5_000_000_000 },
    limits: {
      max_import_bytes: 100 * 1024 * MB,
      max_packets_per_import: 25_000_000,
      upload_chunk_bytes: 32 * MB,
      import_concurrency: 3,
      ring_file_mb: 2_048,
      ring_files: 400,
      snaplen_bytes: 65_536,
      dissect_workers: 8,
      dissect_depth: "application",
      max_flows_per_second: 120_000,
      max_packets_per_second: 600_000,
      receiver_workers: 8,
      socket_buffer_mb: 128,
      copy_batch_rows: 50_000,
      flush_interval_ms: 500,
      queue_high_water: 2_000_000,
      spool_max_gb: 120,
      rollup_seconds: 60,
      raw_packet_hours: 48,
      flow_metadata_days: 14,
      summary_days: 365,
      local_max_gb: 1_700,
      compress_after_hours: 2,
    },
  },
  {
    id: "xl",
    label: "XL",
    blurb: "10 Gbps line-rate metadata extraction and 200k+ flows/s.",
    requires: { vcpu: 32, ram_gb: 128, disk_gb: 4_000 },
    headline: { flows_per_second: 200_000, capture_bps: 10_000_000_000 },
    limits: {
      max_import_bytes: 0,
      max_packets_per_import: 0,
      upload_chunk_bytes: 64 * MB,
      import_concurrency: 4,
      ring_file_mb: 4_096,
      ring_files: 512,
      snaplen_bytes: 16_384,
      dissect_workers: 16,
      dissect_depth: "application",
      max_flows_per_second: 250_000,
      max_packets_per_second: 1_500_000,
      receiver_workers: 16,
      socket_buffer_mb: 256,
      copy_batch_rows: 100_000,
      flush_interval_ms: 400,
      queue_high_water: 5_000_000,
      spool_max_gb: 300,
      rollup_seconds: 60,
      raw_packet_hours: 72,
      flow_metadata_days: 30,
      summary_days: 365,
      local_max_gb: 3_500,
      compress_after_hours: 2,
    },
  },
];

export function profileById(id: CapacityProfileId): CapacityProfile | null {
  return CAPACITY_PROFILES.find((profile) => profile.id === id) ?? null;
}

export function limitsForProfile(id: Exclude<CapacityProfileId, "custom">): CapacityLimits {
  const profile = profileById(id) as CapacityProfile;
  return { profile: id, ...profile.limits };
}

export const DEFAULT_CAPACITY_LIMITS: CapacityLimits = limitsForProfile("small");

/** Resources the appliance reports about the VM it runs on. */
export type HostResources = {
  vcpu: number;
  ram_gb: number;
  disk_total_gb: number;
  disk_free_gb: number;
  /** Sequential write throughput measured at install, MB/s (null when unknown). */
  disk_write_mbps?: number | null;
};

/** Picks the richest profile the detected VM can actually sustain. */
export function recommendProfile(host: HostResources): CapacityProfile {
  const ordered = [...CAPACITY_PROFILES].reverse();
  const fit = ordered.find(
    (profile) =>
      host.vcpu >= profile.requires.vcpu &&
      host.ram_gb >= profile.requires.ram_gb * 0.9 &&
      host.disk_total_gb >= profile.requires.disk_gb * 0.9,
  );
  return fit ?? (profileById("small") as CapacityProfile);
}

export type CapacityIssue = {
  field: keyof CapacityLimits | "profile";
  level: "error" | "warning";
  message: string;
};

/**
 * Validates limits against detected resources. Errors block saving; warnings
 * are shown inline so the operator can accept a deliberate over-subscription.
 */
export function validateLimits(
  limits: CapacityLimits,
  host: HostResources | null,
): CapacityIssue[] {
  const issues: CapacityIssue[] = [];
  const positive = (field: keyof CapacityLimits, value: number, label: string) => {
    if (!Number.isFinite(value) || value < 0) {
      issues.push({ field, level: "error", message: `${label} must be zero or greater.` });
    }
  };

  positive("max_import_bytes", limits.max_import_bytes, "Max import size");
  positive("max_packets_per_import", limits.max_packets_per_import, "Packets per import");

  if (limits.upload_chunk_bytes < MB) {
    issues.push({
      field: "upload_chunk_bytes",
      level: "error",
      message: "Upload chunk size must be at least 1 MB.",
    });
  }
  if (limits.rollup_seconds < 10) {
    issues.push({
      field: "rollup_seconds",
      level: "error",
      message: "Rollup interval below 10s creates more rows than it saves.",
    });
  }
  if (limits.raw_packet_hours < 1) {
    issues.push({
      field: "raw_packet_hours",
      level: "error",
      message: "Keep at least one hour of raw packets for drill-down.",
    });
  }
  if (limits.compress_after_hours >= limits.raw_packet_hours) {
    issues.push({
      field: "compress_after_hours",
      level: "warning",
      message: "Compression kicks in after raw data is already purged; lower it to save disk.",
    });
  }

  if (!host) return issues;

  if (limits.dissect_workers + limits.receiver_workers > host.vcpu * 2) {
    issues.push({
      field: "dissect_workers",
      level: "warning",
      message: `Dissection + receiver workers (${
        limits.dissect_workers + limits.receiver_workers
      }) exceed twice the ${host.vcpu} detected vCPU; expect scheduler contention.`,
    });
  }

  const ramNeededGb =
    (limits.queue_high_water * 400) / 1e9 +
    (limits.receiver_workers * limits.socket_buffer_mb) / 1024 +
    limits.dissect_workers * 0.5 +
    2;
  if (ramNeededGb > host.ram_gb * 0.7) {
    issues.push({
      field: "queue_high_water",
      level: "warning",
      message: `Queues and buffers could need ~${ramNeededGb.toFixed(
        1,
      )} GB of the ${host.ram_gb} GB detected; reduce the queue high-water mark or socket buffers.`,
    });
  }

  const ringGb = (limits.ring_file_mb * limits.ring_files) / 1024;
  if (ringGb + limits.spool_max_gb + limits.local_max_gb > host.disk_total_gb) {
    issues.push({
      field: "local_max_gb",
      level: "error",
      message: `Ring buffer (${ringGb.toFixed(0)} GB) + spool (${
        limits.spool_max_gb
      } GB) + database (${limits.local_max_gb} GB) exceed the ${
        host.disk_total_gb
      } GB disk. Lower one of them.`,
    });
  }

  const projected = projectDailyBytes(limits);
  const days = limits.local_max_gb / (projected.compressed_per_day / 1e9);
  if (days < limits.flow_metadata_days) {
    issues.push({
      field: "flow_metadata_days",
      level: "warning",
      message: `At ${limits.max_flows_per_second.toLocaleString()} flows/s the disk budget holds about ${days.toFixed(
        1,
      )} days, short of the ${limits.flow_metadata_days}-day target. Raise the budget or lower retention.`,
    });
  }

  return issues;
}

/** Reference bytes per stored row, used for disk projections. */
export const ROW_BYTES = { flow: 250, flow_compressed: 30, packet: 400, packet_compressed: 60 };

export function projectDailyBytes(limits: CapacityLimits) {
  const seconds = 86_400;
  const flowsPerDay = limits.max_flows_per_second * seconds;
  const packetsPerDay = limits.max_packets_per_second * seconds;
  return {
    flows_per_day: flowsPerDay,
    packets_per_day: packetsPerDay,
    raw_per_day: flowsPerDay * ROW_BYTES.flow + packetsPerDay * ROW_BYTES.packet,
    compressed_per_day:
      flowsPerDay * ROW_BYTES.flow_compressed + packetsPerDay * ROW_BYTES.packet_compressed,
  };
}

/** How long the configured disk budget lasts at the configured ceilings. */
export function projectRunwayHours(limits: CapacityLimits): number {
  const perHour = projectDailyBytes(limits).compressed_per_day / 24;
  if (perHour <= 0) return Infinity;
  return (limits.local_max_gb * 1e9) / perHour;
}

/** Live pressure snapshot the appliance reports each heartbeat. */
export type CapacityRuntime = {
  profile: CapacityProfileId;
  shed_stage: ShedStage;
  shed_reason: string | null;
  flows_per_second: number;
  packets_per_second: number;
  queue_depth: number;
  spool_bytes: number;
  db_bytes: number;
  db_write_lag_ms: number;
  dropped_total: number;
  host: HostResources | null;
  updated_at: string;
};

export function normalizeLimits(input: unknown): CapacityLimits {
  const raw = (input ?? {}) as Partial<CapacityLimits>;
  const base = raw.profile && raw.profile !== "custom"
    ? limitsForProfile(raw.profile as Exclude<CapacityProfileId, "custom">)
    : DEFAULT_CAPACITY_LIMITS;
  const merged = { ...base, ...raw } as CapacityLimits;
  merged.profile = raw.profile ?? base.profile;
  return merged;
}

/** True when the limits no longer match their named profile. */
export function isCustomized(limits: CapacityLimits): boolean {
  if (limits.profile === "custom") return true;
  const base = limitsForProfile(limits.profile);
  return (Object.keys(base) as (keyof CapacityLimits)[]).some(
    (key) => key !== "profile" && base[key] !== limits[key],
  );
}

export function formatLimitBytes(bytes: number): string {
  if (bytes === 0) return "Unlimited";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value % 1 === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export function formatCount(value: number): string {
  return value === 0 ? "Unlimited" : value.toLocaleString();
}
