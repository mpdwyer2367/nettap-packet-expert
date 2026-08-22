/**
 * Client-side decryption key material.
 *
 * Keys never leave the browser: TLS key-log secrets and Wi-Fi passphrases are
 * kept in localStorage on the analyst's machine, used to decrypt the capture
 * locally, and only the decoded results are uploaded.
 */

export type TlsKeylogEntry = {
  label: string;
  clientRandom: string;
  secret: string;
};

export type WpaCredential = {
  ssid: string;
  passphrase: string;
};

export type DecryptionKeys = {
  /** Raw contents of an SSLKEYLOGFILE. */
  tlsKeylog: string;
  wpa: WpaCredential[];
};

export const EMPTY_KEYS: DecryptionKeys = { tlsKeylog: "", wpa: [] };

const STORAGE_KEY = "nettap.decryption-keys";

export function loadKeys(): DecryptionKeys {
  if (typeof window === "undefined") return EMPTY_KEYS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_KEYS;
    const parsed = JSON.parse(raw) as Partial<DecryptionKeys>;
    return {
      tlsKeylog: typeof parsed.tlsKeylog === "string" ? parsed.tlsKeylog : "",
      wpa: Array.isArray(parsed.wpa)
        ? parsed.wpa.filter((entry) => entry && typeof entry.ssid === "string" && typeof entry.passphrase === "string")
        : [],
    };
  } catch {
    return EMPTY_KEYS;
  }
}

export function saveKeys(keys: DecryptionKeys) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export function clearKeys() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function hasKeyMaterial(keys: DecryptionKeys) {
  return parseKeylog(keys.tlsKeylog).length > 0 || keys.wpa.length > 0;
}

const KEYLOG_LABELS = new Set([
  "CLIENT_RANDOM",
  "CLIENT_HANDSHAKE_TRAFFIC_SECRET",
  "SERVER_HANDSHAKE_TRAFFIC_SECRET",
  "CLIENT_TRAFFIC_SECRET_0",
  "SERVER_TRAFFIC_SECRET_0",
  "EXPORTER_SECRET",
  "CLIENT_EARLY_TRAFFIC_SECRET",
]);

/** Parses an SSLKEYLOGFILE (NSS key log format). */
export function parseKeylog(contents: string): TlsKeylogEntry[] {
  const entries: TlsKeylogEntry[] = [];
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [label, clientRandom, secret] = trimmed.split(/\s+/);
    if (!label || !clientRandom || !secret) continue;
    if (!KEYLOG_LABELS.has(label)) continue;
    if (!/^[0-9a-f]{64}$/i.test(clientRandom) || !/^[0-9a-f]{32,}$/i.test(secret)) continue;
    entries.push({ label, clientRandom: clientRandom.toLowerCase(), secret: secret.toLowerCase() });
  }
  return entries;
}

export function summarizeKeylog(contents: string) {
  const entries = parseKeylog(contents);
  const labels = new Map<string, number>();
  for (const entry of entries) labels.set(entry.label, (labels.get(entry.label) ?? 0) + 1);
  const sessions = new Set(entries.map((entry) => entry.clientRandom)).size;
  return { entries: entries.length, sessions, labels: [...labels.entries()] };
}

export function hexToBytes(hex: string) {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  const bytes = new Uint8Array(Math.floor(clean.length / 2));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array) {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
