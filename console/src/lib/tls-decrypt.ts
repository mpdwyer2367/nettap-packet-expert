/**
 * Browser-side TLS decryption from an SSLKEYLOGFILE.
 *
 * TCP streams are reassembled from the capture, TLS records are parsed, and
 * AES-GCM records are decrypted with WebCrypto using the key-log secrets:
 *   - TLS 1.3: {CLIENT,SERVER}_TRAFFIC_SECRET_0 + HKDF-Expand-Label
 *   - TLS 1.2: CLIENT_RANDOM (master secret) + the TLS 1.2 PRF key block
 * ChaCha20-Poly1305 and CBC suites are reported as unsupported rather than
 * silently skipped. Keys and plaintext never leave the browser — only the
 * dissected fields are uploaded.
 */

import { bytesToHex, hexToBytes, parseKeylog, type TlsKeylogEntry } from "./decrypt-keys";
import { dissectHttp, RISK_TAGS, type DissectResult } from "./dissect";
import { decodeFrameBytes, frameBytes, readRawFrames } from "./pcap-parse";

export type DecryptedRecord = {
  frame_number: number;
  ts: string | null;
  src_ip: string | null;
  dst_ip: string | null;
  src_port: number | null;
  dst_port: number | null;
  protocol: string;
  app_protocol: string | null;
  service: string | null;
  summary: string | null;
  fields: Record<string, string>;
  risk_tags: string[];
  length: number;
};

export type TlsDecryptResult = {
  records: DecryptedRecord[];
  sessions: number;
  decryptedSessions: number;
  unsupported: string[];
  notes: string[];
};

const EMPTY: TlsDecryptResult = {
  records: [],
  sessions: 0,
  decryptedSessions: 0,
  unsupported: [],
  notes: [],
};

/* ------------------------------------------------------------- primitives */

const CIPHERS: Record<
  number,
  { name: string; keyLength: number; ivLength: number; hash: "SHA-256" | "SHA-384"; aead: "gcm" | "other"; tls13: boolean }
> = {
  0x1301: { name: "TLS_AES_128_GCM_SHA256", keyLength: 16, ivLength: 12, hash: "SHA-256", aead: "gcm", tls13: true },
  0x1302: { name: "TLS_AES_256_GCM_SHA384", keyLength: 32, ivLength: 12, hash: "SHA-384", aead: "gcm", tls13: true },
  0x1303: { name: "TLS_CHACHA20_POLY1305_SHA256", keyLength: 32, ivLength: 12, hash: "SHA-256", aead: "other", tls13: true },
  0xc02f: { name: "ECDHE_RSA_AES_128_GCM_SHA256", keyLength: 16, ivLength: 4, hash: "SHA-256", aead: "gcm", tls13: false },
  0xc02b: { name: "ECDHE_ECDSA_AES_128_GCM_SHA256", keyLength: 16, ivLength: 4, hash: "SHA-256", aead: "gcm", tls13: false },
  0xc030: { name: "ECDHE_RSA_AES_256_GCM_SHA384", keyLength: 32, ivLength: 4, hash: "SHA-384", aead: "gcm", tls13: false },
  0xc02c: { name: "ECDHE_ECDSA_AES_256_GCM_SHA384", keyLength: 32, ivLength: 4, hash: "SHA-384", aead: "gcm", tls13: false },
  0x009c: { name: "RSA_AES_128_GCM_SHA256", keyLength: 16, ivLength: 4, hash: "SHA-256", aead: "gcm", tls13: false },
  0x009d: { name: "RSA_AES_256_GCM_SHA384", keyLength: 32, ivLength: 4, hash: "SHA-384", aead: "gcm", tls13: false },
};

async function hmac(hash: string, key: Uint8Array, data: Uint8Array) {
  const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data as BufferSource));
}

function concat(...parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const encoder = new TextEncoder();

/** HKDF-Expand-Label from RFC 8446. */
async function expandLabel(hash: string, secret: Uint8Array, label: string, length: number) {
  const fullLabel = encoder.encode(`tls13 ${label}`);
  const info = concat(
    new Uint8Array([length >> 8, length & 0xff]),
    new Uint8Array([fullLabel.length]),
    fullLabel,
    new Uint8Array([0]),
  );
  const out = new Uint8Array(length);
  let previous = new Uint8Array(0);
  let position = 0;
  let counter = 1;
  while (position < length) {
    previous = await hmac(hash, secret, concat(previous, info, new Uint8Array([counter])));
    out.set(previous.subarray(0, Math.min(previous.length, length - position)), position);
    position += previous.length;
    counter += 1;
  }
  return out;
}

/** TLS 1.2 PRF (P_hash with the HMAC of the negotiated hash). */
async function prf12(hash: string, secret: Uint8Array, label: string, seed: Uint8Array, length: number) {
  const labelSeed = concat(encoder.encode(label), seed);
  const out = new Uint8Array(length);
  let a = await hmac(hash, secret, labelSeed);
  let position = 0;
  while (position < length) {
    const block = await hmac(hash, secret, concat(a, labelSeed));
    out.set(block.subarray(0, Math.min(block.length, length - position)), position);
    position += block.length;
    a = await hmac(hash, secret, a);
  }
  return out;
}

async function gcmKey(raw: Uint8Array) {
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, ["decrypt"]);
}

async function gcmDecrypt(key: CryptoKey, nonce: Uint8Array, aad: Uint8Array, body: Uint8Array) {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
      key,
      body as BufferSource,
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}

function nonceFor(iv: Uint8Array, sequence: number) {
  const nonce = iv.slice();
  const view = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
  const low = view.getUint32(nonce.length - 4, false);
  const high = view.getUint32(nonce.length - 8, false);
  const seqLow = sequence >>> 0;
  view.setUint32(nonce.length - 4, low ^ seqLow, false);
  view.setUint32(nonce.length - 8, high ^ Math.floor(sequence / 2 ** 32), false);
  return nonce;
}

/* ------------------------------------------------------- TCP reassembly */

type Segment = { seq: number; bytes: Uint8Array };

type Direction = {
  src_ip: string | null;
  dst_ip: string | null;
  src_port: number | null;
  dst_port: number | null;
  frame_number: number;
  ts: string | null;
  segments: Segment[];
};

function reassemble(direction: Direction) {
  const sorted = [...direction.segments].sort((a, b) => a.seq - b.seq);
  if (sorted.length === 0) return new Uint8Array(0);
  const parts: Uint8Array[] = [];
  let expected = sorted[0]!.seq;
  for (const segment of sorted) {
    if (segment.seq < expected) {
      const overlap = expected - segment.seq;
      if (overlap >= segment.bytes.length) continue;
      parts.push(segment.bytes.subarray(overlap));
      expected = segment.seq + segment.bytes.length;
      continue;
    }
    if (segment.seq > expected && parts.length > 0) break; // gap: stop, the rest cannot be trusted
    parts.push(segment.bytes);
    expected = segment.seq + segment.bytes.length;
  }
  return concat(...parts);
}

type TlsRecord = { type: number; version: number; body: Uint8Array; header: Uint8Array };

function parseRecords(stream: Uint8Array): TlsRecord[] {
  const records: TlsRecord[] = [];
  let offset = 0;
  while (offset + 5 <= stream.length) {
    const type = stream[offset]!;
    const version = (stream[offset + 1]! << 8) | stream[offset + 2]!;
    const length = (stream[offset + 3]! << 8) | stream[offset + 4]!;
    if (type < 20 || type > 24 || version < 0x0300 || version > 0x0304) break;
    if (offset + 5 + length > stream.length) break;
    records.push({
      type,
      version,
      header: stream.subarray(offset, offset + 5),
      body: stream.subarray(offset + 5, offset + 5 + length),
    });
    offset += 5 + length;
  }
  return records;
}

function findHandshake(records: TlsRecord[], handshakeType: number) {
  for (const record of records) {
    if (record.type === 22 && record.body[0] === handshakeType) return record.body;
  }
  return null;
}

/* ----------------------------------------------------------- decryption */

type SessionKeys = {
  cipher: (typeof CIPHERS)[number];
  clientKey: CryptoKey;
  serverKey: CryptoKey;
  clientIv: Uint8Array;
  serverIv: Uint8Array;
  tls13: boolean;
};

async function deriveTls13(
  entries: TlsKeylogEntry[],
  clientRandom: string,
  cipher: (typeof CIPHERS)[number],
): Promise<SessionKeys | null> {
  const find = (label: string) =>
    entries.find((entry) => entry.label === label && entry.clientRandom === clientRandom)?.secret;
  const clientSecret = find("CLIENT_TRAFFIC_SECRET_0");
  const serverSecret = find("SERVER_TRAFFIC_SECRET_0");
  if (!clientSecret || !serverSecret) return null;
  const client = hexToBytes(clientSecret);
  const server = hexToBytes(serverSecret);
  return {
    cipher,
    tls13: true,
    clientKey: await gcmKey(await expandLabel(cipher.hash, client, "key", cipher.keyLength)),
    serverKey: await gcmKey(await expandLabel(cipher.hash, server, "key", cipher.keyLength)),
    clientIv: await expandLabel(cipher.hash, client, "iv", 12),
    serverIv: await expandLabel(cipher.hash, server, "iv", 12),
  };
}

async function deriveTls12(
  entries: TlsKeylogEntry[],
  clientRandom: string,
  serverRandom: Uint8Array,
  cipher: (typeof CIPHERS)[number],
): Promise<SessionKeys | null> {
  const master = entries.find((entry) => entry.label === "CLIENT_RANDOM" && entry.clientRandom === clientRandom)?.secret;
  if (!master) return null;
  const seed = concat(serverRandom, hexToBytes(clientRandom));
  const blockLength = 2 * (cipher.keyLength + cipher.ivLength);
  const block = await prf12(cipher.hash, hexToBytes(master), "key expansion", seed, blockLength);
  let offset = 0;
  const clientKeyRaw = block.subarray(offset, (offset += cipher.keyLength));
  const serverKeyRaw = block.subarray(offset, (offset += cipher.keyLength));
  const clientIv = block.subarray(offset, (offset += cipher.ivLength));
  const serverIv = block.subarray(offset, offset + cipher.ivLength);
  return {
    cipher,
    tls13: false,
    clientKey: await gcmKey(clientKeyRaw),
    serverKey: await gcmKey(serverKeyRaw),
    clientIv: clientIv.slice(),
    serverIv: serverIv.slice(),
  };
}

function stripTls13Padding(plain: Uint8Array) {
  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) end -= 1;
  if (end === 0) return null;
  return { contentType: plain[end - 1]!, body: plain.subarray(0, end - 1) };
}

async function decryptDirection(
  records: TlsRecord[],
  keys: SessionKeys,
  side: "client" | "server",
): Promise<Uint8Array[]> {
  const key = side === "client" ? keys.clientKey : keys.serverKey;
  const iv = side === "client" ? keys.clientIv : keys.serverIv;
  const plaintexts: Uint8Array[] = [];
  let sequence = 0;
  let locked = false;

  for (const record of records) {
    if (keys.tls13) {
      if (record.type !== 23) continue;
      let plain: Uint8Array | null = null;
      const maxProbe = locked ? 0 : 6;
      for (let probe = 0; probe <= maxProbe; probe += 1) {
        plain = await gcmDecrypt(key, nonceFor(iv, sequence + probe), record.header, record.body);
        if (plain) {
          sequence += probe;
          locked = true;
          break;
        }
      }
      sequence += 1;
      if (!plain) continue;
      const stripped = stripTls13Padding(plain);
      if (stripped && stripped.contentType === 23 && stripped.body.length) plaintexts.push(stripped.body.slice());
      continue;
    }

    if (record.type === 20) {
      sequence = 0; // ChangeCipherSpec resets the record sequence for the new keys
      continue;
    }
    if (record.type !== 23 || record.body.length < 24) continue;
    const explicit = record.body.subarray(0, 8);
    const body = record.body.subarray(8);
    const nonce = concat(iv, explicit);
    const plainLength = body.length - 16;
    const seqBytes = new Uint8Array(8);
    new DataView(seqBytes.buffer).setUint32(4, sequence, false);
    const aad = concat(
      seqBytes,
      new Uint8Array([record.type, record.version >> 8, record.version & 0xff, plainLength >> 8, plainLength & 0xff]),
    );
    const plain = await gcmDecrypt(key, nonce, aad, body);
    sequence += 1;
    if (plain?.length) plaintexts.push(plain.slice());
  }
  return plaintexts;
}

/* ------------------------------------------------ plaintext dissection */

const decoder = new TextDecoder("utf-8", { fatal: false });

function dissectPlaintext(streams: Uint8Array[]): DissectResult[] {
  const results: DissectResult[] = [];
  const body = decoder.decode(concat(...streams));
  if (!body) return results;

  // HTTP/1.x messages are the common case behind TLS on 443.
  const boundary = /(?:^|\r\n)(?=(?:GET|POST|PUT|HEAD|DELETE|OPTIONS|PATCH|TRACE|CONNECT|PROPFIND) \S+ HTTP\/1\.|HTTP\/1\.[01] \d{3})/g;
  const pieces = body.split(boundary).filter((piece) => piece.trim().length > 0);
  for (const piece of pieces.slice(0, 40)) {
    const http = dissectHttp(piece.replace(/^\r\n/, ""));
    if (http) results.push(http);
  }
  if (results.length > 0) return results;

  if (body.startsWith("\x00\x00")) return results;
  const preview = body.replace(/[^\x20-\x7e]/g, " ").trim().slice(0, 160);
  if (preview.length > 8) {
    results.push({
      app_protocol: "TLS payload",
      service: "TLS",
      summary: `Decrypted TLS payload: ${preview}`,
      fields: { "tls.decrypted_preview": preview },
      risk_tags: [],
    });
  }
  return results;
}

/* ----------------------------------------------------------- entry point */

/** Decrypts the TLS sessions in a capture using an SSLKEYLOGFILE. */
export async function decryptTlsCapture(buffer: ArrayBuffer, keylog: string): Promise<TlsDecryptResult> {
  const entries = parseKeylog(keylog);
  if (entries.length === 0) return EMPTY;

  const view = new DataView(buffer);
  const frames = readRawFrames(view);
  if (frames.length === 0) return EMPTY;

  const directions = new Map<string, Direction>();
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]!;
    const layer = decodeFrameBytes(frameBytes(view, frame), frame.linkType);
    if (!layer || layer.ip_proto !== 6 || layer.payload_start === null || layer.payload_end === null) continue;
    const length = layer.payload_end - layer.payload_start;
    if (length <= 0) continue;
    const key = `${layer.src_ip}:${layer.src_port}>${layer.dst_ip}:${layer.dst_port}`;
    let direction = directions.get(key);
    if (!direction) {
      direction = {
        src_ip: layer.src_ip,
        dst_ip: layer.dst_ip,
        src_port: layer.src_port,
        dst_port: layer.dst_port,
        frame_number: index + 1,
        ts: frame.ts,
        segments: [],
      };
      directions.set(key, direction);
    }
    if (direction.segments.length < 4000) {
      const bytes = frameBytes(view, frame).slice(
        layer.payload_start - frame.start,
        layer.payload_end - frame.start,
      );
      direction.segments.push({ seq: layer.tcp_seq ?? direction.segments.length, bytes });
    }
  }

  const records: DecryptedRecord[] = [];
  const unsupported = new Set<string>();
  const notes: string[] = [];
  let sessions = 0;
  let decryptedSessions = 0;
  const handled = new Set<string>();

  for (const [key, direction] of directions) {
    if (handled.has(key)) continue;
    const reverseKey = `${direction.dst_ip}:${direction.dst_port}>${direction.src_ip}:${direction.src_port}`;
    const reverse = directions.get(reverseKey);
    handled.add(key);
    if (reverse) handled.add(reverseKey);

    const clientStream = reassemble(direction);
    const clientRecords = parseRecords(clientStream);
    const clientHello = findHandshake(clientRecords, 1);
    if (!clientHello || clientHello.length < 38) continue;
    sessions += 1;

    const clientRandom = bytesToHex(clientHello.subarray(6, 38));
    const serverRecords = reverse ? parseRecords(reassemble(reverse)) : [];
    const serverHello = findHandshake(serverRecords, 2);
    if (!serverHello || serverHello.length < 40) {
      notes.push(`No Server Hello reassembled for ${key} — session skipped.`);
      continue;
    }
    const serverRandom = serverHello.subarray(6, 38).slice();
    const sessionIdLength = serverHello[38] ?? 0;
    const suite = ((serverHello[39 + sessionIdLength] ?? 0) << 8) | (serverHello[40 + sessionIdLength] ?? 0);
    const cipher = CIPHERS[suite];
    if (!cipher) {
      unsupported.add(`cipher suite 0x${suite.toString(16).padStart(4, "0")}`);
      continue;
    }
    if (cipher.aead !== "gcm") {
      unsupported.add(cipher.name);
      continue;
    }

    const keys = cipher.tls13
      ? await deriveTls13(entries, clientRandom, cipher)
      : await deriveTls12(entries, clientRandom, serverRandom, cipher);
    if (!keys) {
      notes.push(`No key-log secret for session ${clientRandom.slice(0, 16)}… (${cipher.name}).`);
      continue;
    }

    const clientPlain = await decryptDirection(clientRecords, keys, "client");
    const serverPlain = await decryptDirection(serverRecords, keys, "server");
    if (clientPlain.length === 0 && serverPlain.length === 0) continue;
    decryptedSessions += 1;

    const push = (dissections: DissectResult[], from: Direction) => {
      for (const dissection of dissections) {
        records.push({
          frame_number: from.frame_number,
          ts: from.ts,
          src_ip: from.src_ip,
          dst_ip: from.dst_ip,
          src_port: from.src_port,
          dst_port: from.dst_port,
          protocol: "TCP",
          app_protocol: dissection.app_protocol,
          service: dissection.service ?? "TLS",
          summary: dissection.summary,
          fields: { ...dissection.fields, "tls.cipher_suite": cipher.name, "tls.decrypted": "true" },
          risk_tags: [...new Set([...dissection.risk_tags, RISK_TAGS.c2Exfil])].filter(
            (tag) => tag !== RISK_TAGS.c2Exfil || dissection.app_protocol === "HTTP",
          ),
          length: 0,
        });
      }
    };

    push(dissectPlaintext(clientPlain), direction);
    if (reverse) push(dissectPlaintext(serverPlain), reverse);
  }

  return {
    records,
    sessions,
    decryptedSessions,
    unsupported: [...unsupported],
    notes: notes.slice(0, 10),
  };
}
