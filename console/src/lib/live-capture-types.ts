/**
 * Client-safe shapes for live Wi-Fi / NIC capture sessions.
 *
 * A browser cannot open a network interface, so live monitoring works through a
 * small agent script the user runs locally: dumpcap grabs rolling slices from
 * the interface, tshark dissects them to Elasticsearch-style NDJSON, and the
 * agent POSTs each slice to /api/public/live-ingest with a session token.
 */

export type CaptureOs = "windows" | "macos" | "linux";

export const CAPTURE_OS_OPTIONS: {
  value: CaptureOs;
  label: string;
  driver: string;
  listCommand: string;
  monitorMode: string;
  notes: string;
}[] = [
  {
    value: "windows",
    label: "Windows (Npcap / WinPcap)",
    driver: "Npcap (install with \"WinPcap API-compatible mode\" checked)",
    listCommand: "dumpcap -D",
    monitorMode:
      "Npcap can only put a Wi-Fi adapter in monitor mode on some chipsets; without it you see this host's traffic plus broadcast/multicast.",
    notes:
      "Run PowerShell as Administrator. Wireshark's install folder (C:\\Program Files\\Wireshark) must be on PATH.",
  },
  {
    value: "macos",
    label: "macOS (libpcap)",
    driver: "libpcap (bundled) — ChmodBPF from the Wireshark installer avoids sudo",
    listCommand: "dumpcap -D",
    monitorMode:
      "Monitor mode: sudo /System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport en0 sniff <channel>",
    notes: "Interfaces are usually en0 (Wi-Fi) or en1. Requires the Wireshark CLI tools installed.",
  },
  {
    value: "linux",
    label: "Linux (libpcap)",
    driver: "libpcap — grant capture rights with: sudo setcap cap_net_raw,cap_net_admin+eip $(which dumpcap)",
    listCommand: "dumpcap -D",
    monitorMode:
      "Monitor mode: sudo iw dev wlan0 set type monitor (or airmon-ng start wlan0) before starting the agent.",
    notes: "Interfaces are usually wlan0 / wlp3s0. tshark must be installed alongside dumpcap.",
  },
];

export function describeCaptureOs(value: string | null | undefined) {
  return CAPTURE_OS_OPTIONS.find((option) => option.value === value) ?? CAPTURE_OS_OPTIONS[0]!;
}

export type LiveSessionStatus = "pending" | "live" | "paused" | "stopped" | "finalized";

export type LiveSessionSummary = {
  id: string;
  dataset_id: string;
  os: string;
  interface_name: string;
  capture_filter: string | null;
  slice_seconds: number;
  vantage: string;
  observation_point: string | null;
  status: string;
  packet_count: number;
  byte_count: number;
  batch_count: number;
  last_error: string | null;
  last_seen_at: string | null;
  expires_at: string;
  created_at: string;
  dataset_name: string;
};

export type LiveMetricBucket = {
  bucket_ts: string;
  packets: number;
  bytes: number;
  top: {
    talkers?: { ip: string; bytes: number }[];
    protocols?: { protocol: string; packets: number }[];
    ports?: { port: number; packets: number }[];
  };
};

/** Max NDJSON bytes accepted per streamed slice. */
export const MAX_SLICE_BYTES = 4_000_000;
/** Hard ceiling on packets stored per live session. */
export const MAX_SESSION_PACKETS = 250_000;
