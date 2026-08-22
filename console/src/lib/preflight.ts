import { decodeCapture, isCaptureFile, readCaptureBuffer, type DecodedPacket } from "./pcap-parse";
import { decodeTsharkExport, detectTsharkExport } from "./tshark-import";
import {
  normalizeTelemetryHeader,
  suggestFlowMapping,
  type FlowColumnMapping,
} from "./telemetry-parse";

export type PreflightFormat = "auto" | "pcapng" | "pcap" | "csv" | "tshark" | "text";

export type PreflightSummary = {
  /** How the file will be decoded at ingest time. */
  route: "capture" | "tshark" | "table" | "text";
  label: string;
  packetCount?: number;
  sampledTo?: number | undefined;
  skipped?: number;
  flowCount?: number;
  firstSeen?: string | null;
  lastSeen?: string | null;
  columns?: string[];
  /** Header names after normalization — these are the keys the parser maps on. */
  normalizedColumns?: string[];
  suggestedMapping?: FlowColumnMapping;
  sampleRows?: Record<string, string>[];
  delimiter?: string;
  rowCount?: number;
  lineCount?: number;
  protocols?: string[];
  warnings: string[];
};

function timeRange(packets: DecodedPacket[]) {
  const stamps = packets
    .map((packet) => packet.ts)
    .filter((value): value is string => Boolean(value))
    .sort();
  return { firstSeen: stamps[0] ?? null, lastSeen: stamps[stamps.length - 1] ?? null };
}

function topProtocols(packets: DecodedPacket[]) {
  const counts = new Map<string, number>();
  for (const packet of packets) {
    const key = packet.protocol ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([protocol, count]) => `${protocol} (${count.toLocaleString()})`);
}

function pickDelimiter(headerLine: string) {
  const candidates = [
    { delimiter: ",", label: "comma" },
    { delimiter: "\t", label: "tab" },
    { delimiter: ";", label: "semicolon" },
    { delimiter: "|", label: "pipe" },
  ];
  let best = candidates[0]!;
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = headerLine.split(candidate.delimiter).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return bestCount > 0 ? best : null;
}

function splitColumns(headerLine: string, delimiter: string) {
  return headerLine
    .split(delimiter)
    .map((column) => column.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

/**
 * Reads the selected file before ingest so the analyst can confirm packet
 * counts, capture time range and CSV column names ahead of storing anything.
 */
export async function inspectTelemetryFile(
  file: File,
  format: PreflightFormat,
  observationPoint?: string,
): Promise<PreflightSummary> {
  const warnings: string[] = [];
  const binaryCapture =
    format === "pcap" || format === "pcapng"
      ? true
      : format === "auto"
        ? isCaptureFile(file.name)
        : false;

  if (binaryCapture) {
    const buffer = await readCaptureBuffer(file);
    const decoded = decodeCapture(buffer, observationPoint);
    const range = timeRange(decoded.packets);
    if (decoded.sampled) {
      warnings.push(
        `Capture holds ${decoded.totalPackets.toLocaleString()} packets — ingest evenly samples ${decoded.packets.length.toLocaleString()}.`,
      );
    }
    if (decoded.skipped > 0) {
      warnings.push(`${decoded.skipped.toLocaleString()} frames could not be dissected.`);
    }
    return {
      route: "capture",
      label: "Packet capture",
      packetCount: decoded.totalPackets,
      sampledTo: decoded.sampled ? decoded.packets.length : undefined,
      skipped: decoded.skipped,
      flowCount: decoded.flows.length,
      firstSeen: range.firstSeen,
      lastSeen: range.lastSeen,
      protocols: topProtocols(decoded.packets),
      warnings,
    };
  }

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (format === "tshark" || (format === "auto" && detectTsharkExport(file.name, text))) {
    const decoded = decodeTsharkExport(text, file.name, observationPoint);
    const range = timeRange(decoded.packets);
    if (decoded.sampled) {
      warnings.push(
        `Export holds ${decoded.totalPackets.toLocaleString()} packets — ingest evenly samples ${decoded.packets.length.toLocaleString()}.`,
      );
    }
    return {
      route: "tshark",
      label: "Wireshark / tshark decode export",
      packetCount: decoded.totalPackets,
      sampledTo: decoded.sampled ? decoded.packets.length : undefined,
      skipped: decoded.skipped,
      flowCount: decoded.flows.length,
      firstSeen: range.firstSeen,
      lastSeen: range.lastSeen,
      protocols: topProtocols(decoded.packets),
      warnings,
    };
  }

  const headerLine = lines[0] ?? "";
  const chosen = format === "text" ? null : pickDelimiter(headerLine);
  if (chosen) {
    const columns = splitColumns(headerLine, chosen.delimiter);
    if (columns.length < 2) warnings.push("Only one column detected — check the delimiter.");
    const normalizedColumns = columns.map((column) => normalizeTelemetryHeader(column));
    const suggestedMapping = suggestFlowMapping(columns);
    if (!suggestedMapping.src_ip || !suggestedMapping.dst_ip) {
      warnings.push(
        "Source/destination IP columns were not recognised — set them in the column mapping below.",
      );
    }
    const sampleRows = lines.slice(1, 4).map((line) => {
      const values = line.split(chosen.delimiter).map((value) => value.trim().replace(/^"|"$/g, ""));
      const row: Record<string, string> = {};
      normalizedColumns.forEach((column, index) => {
        row[column] = values[index] ?? "";
      });
      return row;
    });
    return {
      route: "table",
      label: `Delimited table (${chosen.label}-separated)`,
      columns,
      normalizedColumns,
      suggestedMapping,
      sampleRows,
      delimiter: chosen.label,
      rowCount: Math.max(lines.length - 1, 0),
      lineCount: lines.length,
      warnings,
    };
  }

  return {
    route: "text",
    label: "Plain text / syslog",
    lineCount: lines.length,
    warnings,
  };
}
