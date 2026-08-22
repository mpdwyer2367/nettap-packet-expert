import type { DecodedFlow, DecodedPacket } from "./pcap-parse";
import type { DatasetKind, FlowColumnMapping } from "./telemetry-parse";

/** Client-safe shapes shared by the ingest server function and the upload UI. */
export type CapturePayload = {
  packets: DecodedPacket[];
  flows: DecodedFlow[];
  totalPackets: number;
  skipped: number;
  sampled: boolean;
};

export type CaptureVantage =
  | "unknown"
  | "tap"
  | "span"
  | "host_agent"
  | "inline"
  | "virtual";

/**
 * Where the capture was taken from. The vantage point decides what the data can
 * and cannot prove, so it is surfaced to the model with every dataset overview.
 */
export const CAPTURE_VANTAGES: {
  value: CaptureVantage;
  label: string;
  description: string;
  blindSpots: string;
}[] = [
  {
    value: "unknown",
    label: "Unknown / not specified",
    description: "Vantage point was not recorded.",
    blindSpots:
      "Treat direction, completeness and drops as unverified; ask the analyst where the capture was taken.",
  },
  {
    value: "tap",
    label: "NetTAP packet broker / passive TAP",
    description:
      "Full-duplex passive copy from a broker TAP port; both directions of the link are present at line rate.",
    blindSpots:
      "Only traffic crossing that physical link is visible — intra-switch, intra-host and other VLANs are absent. Broker filtering, dedup, slicing or load-balancing may have trimmed frames before capture.",
  },
  {
    value: "span",
    label: "SPAN / port mirror session",
    description:
      "Switch-generated mirror of one or more ports or VLANs, delivered on a mirror destination port.",
    blindSpots:
      "SPAN is best-effort: oversubscription silently drops frames, so missing packets and one-sided conversations may be mirror loss rather than real behavior. Mirrors commonly strip VLAN tags, drop errored/undersized frames and can duplicate packets when both ports of a conversation are mirrored. Timestamps come from the capture host, not the wire.",
  },
  {
    value: "host_agent",
    label: "Host agent (WinPcap / Npcap / libpcap on the endpoint)",
    description:
      "Capture from an OS-level agent on one endpoint, so only traffic entering or leaving that host is seen.",
    blindSpots:
      "Host-only view: no third-party conversations, and traffic is observed after NIC offload, so TCP/IP checksums, segmentation (LSO/GRO) and coalescing can look wrong. Loopback and inter-VM traffic may be missing, capture can drop under CPU load, and host clock skew affects timestamps. Local firewall drops may not appear at all.",
  },
  {
    value: "inline",
    label: "Inline appliance / bypass segment",
    description: "Capture from a device in the forwarding path (firewall, IPS, bypass tap).",
    blindSpots:
      "The device may rewrite, NAT, proxy, block or re-order traffic, so what is captured is post-policy — absent traffic may have been dropped by policy rather than never sent.",
  },
  {
    value: "virtual",
    label: "Virtual switch / cloud mirror",
    description: "vSwitch port mirror, cloud VPC traffic mirroring or container CNI capture.",
    blindSpots:
      "Subject to mirror sampling and per-session packet limits, truncated payloads, and encapsulation (VXLAN/GENEVE) that hides the inner flow unless decapsulated. East-west traffic outside the mirrored ENI/port group is invisible.",
  },
];

export function describeVantage(value: string | null | undefined) {
  return (
    CAPTURE_VANTAGES.find((option) => option.value === (value ?? "unknown")) ?? CAPTURE_VANTAGES[0]!
  );
}

export type IngestPayload = {
  name: string;
  filename: string;
  text?: string;
  capture?: CapturePayload;
  hint?: DatasetKind;
  /** Analyst-confirmed CSV column mapping for flow fields. */
  columnMapping?: FlowColumnMapping;
  observationPoint?: string;
  vantage?: CaptureVantage;
};

export type IngestResult = {
  id: string;
  kind: DatasetKind;
  records: number;
  chunks: number;
  skipped: number;
  note?: string | undefined;
};

export const DATASET_KIND_LABELS: Record<DatasetKind, string> = {
  flow: "IPFIX / NetFlow",
  log: "Device / syslog",
  packet: "Packet capture",
  snmp: "SNMP metrics",
  wmi: "WMI / Windows",
};
