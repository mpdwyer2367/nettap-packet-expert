/**
 * Applies the analyst's local key material to a decoded capture: decrypted TLS
 * and WPA2 records are appended as extra packet records tagged
 * `decryption='decrypted'`, so the analyst and the tools can query plaintext
 * that never existed in the file itself.
 */

import { hasKeyMaterial, type DecryptionKeys } from "./decrypt-keys";
import type { DecodedPacket, PcapDecodeResult } from "./pcap-parse";
import { decryptTlsCapture, type DecryptedRecord } from "./tls-decrypt";
import { decryptWifiCapture } from "./wpa-decrypt";

export type DecryptionSummary = {
  tlsSessions: number;
  tlsDecryptedSessions: number;
  wifiEncryptedFrames: number;
  wifiDecryptedFrames: number;
  addedRecords: number;
  unsupported: string[];
  notes: string[];
};

export const NO_DECRYPTION: DecryptionSummary = {
  tlsSessions: 0,
  tlsDecryptedSessions: 0,
  wifiEncryptedFrames: 0,
  wifiDecryptedFrames: 0,
  addedRecords: 0,
  unsupported: [],
  notes: [],
};

function toPacket(record: DecryptedRecord): DecodedPacket {
  return {
    frame_number: record.frame_number,
    ts: record.ts,
    src_ip: record.src_ip,
    dst_ip: record.dst_ip,
    src_port: record.src_port,
    dst_port: record.dst_port,
    protocol: record.protocol,
    length: record.length,
    tcp_flags: null,
    info: record.summary,
    app_protocol: record.app_protocol,
    service: record.service,
    risk_tags: record.risk_tags,
    decryption: "decrypted",
    extra: record.fields,
  };
}

/** Decrypts what the keys allow and merges the results into the decode result. */
export async function applyDecryption(
  buffer: ArrayBuffer,
  decoded: PcapDecodeResult,
  keys: DecryptionKeys,
): Promise<{ decoded: PcapDecodeResult; summary: DecryptionSummary }> {
  if (!hasKeyMaterial(keys)) return { decoded, summary: NO_DECRYPTION };

  const summary: DecryptionSummary = { ...NO_DECRYPTION, unsupported: [], notes: [] };
  const extra: DecodedPacket[] = [];

  if (keys.tlsKeylog.trim()) {
    try {
      const tls = await decryptTlsCapture(buffer, keys.tlsKeylog);
      summary.tlsSessions = tls.sessions;
      summary.tlsDecryptedSessions = tls.decryptedSessions;
      summary.unsupported.push(...tls.unsupported);
      summary.notes.push(...tls.notes);
      extra.push(...tls.records.map(toPacket));
    } catch (error) {
      summary.notes.push(`TLS decryption failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  if (keys.wpa.length > 0) {
    try {
      const wifi = await decryptWifiCapture(buffer, keys.wpa);
      summary.wifiEncryptedFrames = wifi.encryptedFrames;
      summary.wifiDecryptedFrames = wifi.decryptedFrames;
      summary.notes.push(...wifi.notes);
      extra.push(...wifi.records.map(toPacket));
    } catch (error) {
      summary.notes.push(`Wi-Fi decryption failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  summary.addedRecords = extra.length;
  return {
    decoded: extra.length ? { ...decoded, packets: [...decoded.packets, ...extra] } : decoded,
    summary,
  };
}
