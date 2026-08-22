/**
 * Browser-side ingestion limits.
 *
 * The console's own upload/decode path used to be pinned by two constants: a
 * 100 MB file cap and a 20,000-packet decode ceiling. Both are now settings.
 * They default from a capacity profile, can be raised by the operator, and are
 * seeded from the paired appliance's profile when one is checked in — so the
 * ceiling follows the hardware instead of the code.
 */

import {
  CAPACITY_PROFILES,
  DEFAULT_CAPACITY_LIMITS,
  limitsForProfile,
  type CapacityLimits,
  type CapacityProfileId,
} from "./capacity";

export type IngestLimits = {
  /** Largest file accepted by the browser ingest path, bytes. 0 = unlimited. */
  max_import_bytes: number;
  /** Packet rows decoded/stored per file. 0 = unlimited (memory permitting). */
  max_packets_per_import: number;
  /** Which profile these came from, for display. */
  profile: CapacityProfileId;
  /** True once the operator edited a value by hand. */
  overridden: boolean;
};

const STORAGE_KEY = "amdai.ingest.limits";

/**
 * The console decodes in the browser tab, so its own default is deliberately
 * more conservative than an appliance profile: a tab has ~2-4 GB of heap.
 * Large files should go through the appliance importer, which streams.
 */
export const BROWSER_SAFE_LIMITS: IngestLimits = {
  max_import_bytes: 2 * 1024 * 1024 * 1024,
  max_packets_per_import: 250_000,
  profile: "small",
  overridden: false,
};

/** Point at which we recommend the appliance streaming importer instead. */
export const BROWSER_STREAMING_HINT_BYTES = 512 * 1024 * 1024;

let cache: IngestLimits | null = null;

function readStorage(): IngestLimits | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<IngestLimits>;
    return {
      max_import_bytes: Number(parsed.max_import_bytes ?? BROWSER_SAFE_LIMITS.max_import_bytes),
      max_packets_per_import: Number(
        parsed.max_packets_per_import ?? BROWSER_SAFE_LIMITS.max_packets_per_import,
      ),
      profile: (parsed.profile ?? "small") as CapacityProfileId,
      overridden: Boolean(parsed.overridden),
    };
  } catch {
    return null;
  }
}

export function getIngestLimits(): IngestLimits {
  if (cache) return cache;
  cache = readStorage() ?? BROWSER_SAFE_LIMITS;
  return cache;
}

export function setIngestLimits(next: Partial<IngestLimits>): IngestLimits {
  const merged: IngestLimits = { ...getIngestLimits(), ...next };
  merged.max_import_bytes = Math.max(0, Math.floor(merged.max_import_bytes));
  merged.max_packets_per_import = Math.max(0, Math.floor(merged.max_packets_per_import));
  cache = merged;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {
      /* storage disabled — settings stay in memory for this tab */
    }
  }
  return merged;
}

/** Applies a named profile to the browser ingest path. */
export function applyProfileToIngest(profile: CapacityProfileId): IngestLimits {
  if (profile === "custom") return setIngestLimits({ profile, overridden: true });
  const limits: CapacityLimits = limitsForProfile(profile);
  return setIngestLimits({
    profile,
    max_import_bytes: limits.max_import_bytes,
    max_packets_per_import: limits.max_packets_per_import,
    overridden: false,
  });
}

/**
 * Seeds the browser limits from a paired appliance's capacity, unless the
 * operator has explicitly overridden them.
 */
export function seedIngestLimitsFromAppliance(limits: CapacityLimits | null | undefined): void {
  if (!limits) return;
  const current = getIngestLimits();
  if (current.overridden) return;
  setIngestLimits({
    profile: limits.profile,
    max_import_bytes: limits.max_import_bytes,
    max_packets_per_import: limits.max_packets_per_import,
    overridden: false,
  });
}

/** Decode ceiling used by the pcap and tshark-export parsers. 0 = unlimited. */
export function getMaxPackets(): number {
  const configured = getIngestLimits().max_packets_per_import;
  return configured > 0 ? configured : Number.MAX_SAFE_INTEGER;
}

export function describeIngestLimits(limits = getIngestLimits()): string {
  const size =
    limits.max_import_bytes === 0
      ? "unlimited file size"
      : `${(limits.max_import_bytes / (1024 * 1024 * 1024)).toFixed(
          limits.max_import_bytes >= 1024 * 1024 * 1024 ? 1 : 2,
        )} GB per file`;
  const packets =
    limits.max_packets_per_import === 0
      ? "all packets"
      : `${limits.max_packets_per_import.toLocaleString()} packets`;
  return `${size}, ${packets}`;
}

export const INGEST_PROFILE_OPTIONS = CAPACITY_PROFILES.map((profile) => ({
  id: profile.id,
  label: profile.label,
  detail: `${(profile.limits.max_import_bytes / (1024 * 1024 * 1024) || 0).toFixed(0)} GB · ${
    profile.limits.max_packets_per_import
      ? `${(profile.limits.max_packets_per_import / 1_000_000).toFixed(1)}M packets`
      : "unlimited packets"
  }`,
}));

export { DEFAULT_CAPACITY_LIMITS };
