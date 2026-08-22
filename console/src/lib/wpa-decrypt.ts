/**
 * Browser-side WPA2-PSK (CCMP/AES) decryption.
 *
 * Requires the 4-way EAPOL handshake for the station in the capture: the PMK is
 * derived from SSID + passphrase (PBKDF2-SHA1, 4096 iterations), the PTK from
 * the handshake nonces and MAC addresses (PRF-384/512 with HMAC-SHA1), and each
 * protected data frame is decrypted with AES-CTR, which is the CCMP payload
 * transform. The message integrity check is not verified, so frames that fail to
 * dissect are dropped rather than reported as plaintext.
 */

import type { WpaCredential } from "./decrypt-keys";
import { dissectPayload, type DissectResult } from "./dissect";
import { decodeIpBytes, frameBytes, readRawFrames } from "./pcap-parse";
import type { DecryptedRecord } from "./tls-decrypt";

export type WpaDecryptResult = {
  records: DecryptedRecord[];
  encryptedFrames: number;
  decryptedFrames: number;
  handshakes: string[];
  notes: string[];
};

const EMPTY: WpaDecryptResult = {
  records: [],
  encryptedFrames: 0,
  decryptedFrames: 0,
  handshakes: [],
  notes: [],
};

const LINKTYPE_IEEE802_11 = 105;
const LINKTYPE_IEEE802_11_RADIOTAP = 127;

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function mac(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(":");
}

function compare(a: Uint8Array, b: Uint8Array) {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index]! !== b[index]!) return a[index]! - b[index]!;
  }
  return 0;
}

async function hmacSha1(key: Uint8Array, data: Uint8Array) {
  const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data as BufferSource));
}

async function pmk(passphrase: string, ssid: string) {
  const base = await crypto.subtle.importKey("raw", encoder.encode(passphrase) as BufferSource, "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-1", salt: encoder.encode(ssid) as BufferSource, iterations: 4096 },
    base,
    256,
  );
  return new Uint8Array(bits);
}

/** IEEE 802.11i PRF-n with HMAC-SHA1. */
async function prf(key: Uint8Array, label: string, data: Uint8Array, bits: number) {
  const out: Uint8Array[] = [];
  const blocks = Math.ceil(bits / 160);
  for (let index = 0; index < blocks; index += 1) {
    out.push(await hmacSha1(key, concat(encoder.encode(label), new Uint8Array([0]), data, new Uint8Array([index]))));
  }
  return concat(...out).subarray(0, bits / 8);
}

type Handshake = { ap: Uint8Array; station: Uint8Array; anonce: Uint8Array; snonce: Uint8Array };

async function ptk(pmkBytes: Uint8Array, handshake: Handshake) {
  const [minMac, maxMac] =
    compare(handshake.ap, handshake.station) < 0
      ? [handshake.ap, handshake.station]
      : [handshake.station, handshake.ap];
  const [minNonce, maxNonce] =
    compare(handshake.anonce, handshake.snonce) < 0
      ? [handshake.anonce, handshake.snonce]
      : [handshake.snonce, handshake.anonce];
  return prf(pmkBytes, "Pairwise key expansion", concat(minMac, maxMac, minNonce, maxNonce), 384);
}

/* -------------------------------------------------------- 802.11 parsing */

type Dot11Frame = {
  type: number;
  subtype: number;
  protected: boolean;
  addr1: Uint8Array;
  addr2: Uint8Array;
  addr3: Uint8Array;
  headerLength: number;
  qos: boolean;
  toDs: boolean;
  fromDs: boolean;
};

function parseDot11(bytes: Uint8Array): Dot11Frame | null {
  if (bytes.length < 24) return null;
  const frameControl = bytes[0]!;
  const flags = bytes[1]!;
  const type = (frameControl >> 2) & 0x03;
  const subtype = (frameControl >> 4) & 0x0f;
  const qos = type === 2 && (subtype & 0x08) !== 0;
  const toDs = (flags & 0x01) !== 0;
  const fromDs = (flags & 0x02) !== 0;
  const fourAddress = toDs && fromDs;
  const headerLength = 24 + (fourAddress ? 6 : 0) + (qos ? 2 : 0);
  if (bytes.length < headerLength) return null;
  return {
    type,
    subtype,
    protected: (flags & 0x40) !== 0,
    addr1: bytes.subarray(4, 10),
    addr2: bytes.subarray(10, 16),
    addr3: bytes.subarray(16, 22),
    headerLength,
    qos,
    toDs,
    fromDs,
  };
}

function radiotapOffset(bytes: Uint8Array, linkType: number) {
  if (linkType !== LINKTYPE_IEEE802_11_RADIOTAP) return 0;
  if (bytes.length < 4) return -1;
  return bytes[2]! | (bytes[3]! << 8);
}

function readSsid(bytes: Uint8Array, header: Dot11Frame) {
  // Beacon: 12 bytes of fixed parameters, then tagged fields (SSID = tag 0).
  let cursor = header.headerLength + 12;
  while (cursor + 2 <= bytes.length) {
    const tag = bytes[cursor]!;
    const length = bytes[cursor + 1]!;
    if (tag === 0) {
      return new TextDecoder().decode(bytes.subarray(cursor + 2, cursor + 2 + length)).replace(/\0+$/, "");
    }
    cursor += 2 + length;
  }
  return null;
}

/** CCMP payload decryption: AES-CTR over the CCM counter blocks. */
async function ccmpDecrypt(tk: Uint8Array, header: Dot11Frame, body: Uint8Array, priority: number) {
  if (body.length < 16) return null;
  const pn = new Uint8Array([body[7]!, body[6]!, body[5]!, body[4]!, body[1]!, body[0]!]);
  const payload = body.subarray(8, body.length - 8); // strip CCMP header and MIC
  if (payload.length <= 0) return null;
  const a2 = header.addr2;
  const nonce = concat(new Uint8Array([priority & 0x0f]), a2, pn);
  const counter = concat(new Uint8Array([0x01]), nonce, new Uint8Array([0x00, 0x01]));
  const key = await crypto.subtle.importKey("raw", tk as BufferSource, { name: "AES-CTR" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-CTR", counter: counter as BufferSource, length: 16 },
    key,
    payload as BufferSource,
  );
  return new Uint8Array(plain);
}

/* ----------------------------------------------------------- entry point */

/** Decrypts WPA2-PSK protected Wi-Fi frames in a capture. */
export async function decryptWifiCapture(
  buffer: ArrayBuffer,
  credentials: WpaCredential[],
): Promise<WpaDecryptResult> {
  if (credentials.length === 0) return EMPTY;
  const view = new DataView(buffer);
  const frames = readRawFrames(view);
  if (frames.length === 0) return EMPTY;

  type FrameEntry = { index: number; ts: string | null; bytes: Uint8Array; header: Dot11Frame };
  const wifi: FrameEntry[] = [];
  let beaconSsid: string | null = null;

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]!;
    if (frame.linkType !== LINKTYPE_IEEE802_11 && frame.linkType !== LINKTYPE_IEEE802_11_RADIOTAP) continue;
    const raw = frameBytes(view, frame);
    const offset = radiotapOffset(raw, frame.linkType);
    if (offset < 0 || offset >= raw.length) continue;
    const bytes = raw.subarray(offset);
    const header = parseDot11(bytes);
    if (!header) continue;
    if (!beaconSsid && header.type === 0 && header.subtype === 8) beaconSsid = readSsid(bytes, header);
    wifi.push({ index, ts: frame.ts, bytes, header });
  }

  if (wifi.length === 0) {
    return { ...EMPTY, notes: ["No 802.11 frames in this capture — Wi-Fi decryption does not apply."] };
  }

  // Collect EAPOL key frames to rebuild the 4-way handshake nonces.
  const handshakes = new Map<string, Handshake>();
  for (const entry of wifi) {
    const { header, bytes } = entry;
    if (header.type !== 2) continue;
    const body = bytes.subarray(header.headerLength);
    // LLC/SNAP with EtherType 0x888e (EAPOL).
    if (body.length < 99 || body[0] !== 0xaa || ((body[6]! << 8) | body[7]!) !== 0x888e) continue;
    const eapol = body.subarray(8);
    if (eapol[1] !== 0x03) continue; // EAPOL-Key
    const keyInfo = (eapol[5]! << 8) | eapol[6]!;
    const nonce = eapol.subarray(17, 49).slice();
    const fromAp = (keyInfo & 0x0008) !== 0 || (keyInfo & 0x2000) === 0 ? (keyInfo & 0x0100) === 0 : false;
    const ack = (keyInfo & 0x0080) !== 0;
    const mic = (keyInfo & 0x0100) !== 0;
    const ap = ack && !mic ? header.addr2 : header.addr1;
    const station = ack && !mic ? header.addr1 : header.addr2;
    const key = `${mac(ap)}|${mac(station)}`;
    const existing = handshakes.get(key) ?? {
      ap: ap.slice(),
      station: station.slice(),
      anonce: new Uint8Array(0),
      snonce: new Uint8Array(0),
    };
    if (ack && !mic) existing.anonce = nonce;
    else if (mic && existing.snonce.length === 0) existing.snonce = nonce;
    handshakes.set(key, existing);
    void fromAp;
  }

  const usable = [...handshakes.entries()].filter(
    ([, handshake]) => handshake.anonce.length === 32 && handshake.snonce.length === 32,
  );

  const encryptedFrames = wifi.filter((entry) => entry.header.protected && entry.header.type === 2).length;
  if (usable.length === 0) {
    return {
      ...EMPTY,
      encryptedFrames,
      notes: [
        "No complete 4-way EAPOL handshake was captured, so the session keys cannot be derived. Restart the capture and force the client to reassociate.",
      ],
    };
  }

  const notes: string[] = [];
  const records: DecryptedRecord[] = [];
  let decryptedFrames = 0;

  for (const credential of credentials) {
    const ssid = credential.ssid.trim() || beaconSsid || "";
    if (!ssid) {
      notes.push("No SSID given and none seen in a beacon frame — Wi-Fi keys cannot be derived.");
      continue;
    }
    const pmkBytes = await pmk(credential.passphrase, ssid);

    for (const [label, handshake] of usable) {
      const ptkBytes = await ptk(pmkBytes, handshake);
      const tk = ptkBytes.subarray(32, 48);
      const stationMac = mac(handshake.station);
      const apMac = mac(handshake.ap);
      let matched = 0;

      for (const entry of wifi) {
        const { header, bytes } = entry;
        if (header.type !== 2 || !header.protected) continue;
        const involved = [mac(header.addr1), mac(header.addr2)];
        if (!involved.includes(stationMac) || !involved.includes(apMac)) continue;
        const priority = header.qos ? (bytes[header.headerLength - 2] ?? 0) & 0x0f : 0;
        let plain: Uint8Array | null = null;
        try {
          plain = await ccmpDecrypt(tk, header, bytes.subarray(header.headerLength), priority);
        } catch {
          plain = null;
        }
        if (!plain || plain.length < 12) continue;
        // Plaintext starts with LLC/SNAP; IP follows the 8-byte SNAP header.
        if (plain[0] !== 0xaa || plain[1] !== 0xaa) continue;
        const etherType = (plain[6]! << 8) | plain[7]!;
        if (etherType !== 0x0800 && etherType !== 0x86dd) continue;
        const layer = decodeIpBytes(plain.subarray(8));
        if (!layer) continue;
        matched += 1;
        decryptedFrames += 1;
        const dissection: DissectResult = layer.dissection;
        records.push({
          frame_number: entry.index + 1,
          ts: entry.ts,
          src_ip: layer.src_ip,
          dst_ip: layer.dst_ip,
          src_port: layer.src_port,
          dst_port: layer.dst_port,
          protocol: layer.protocol ?? "IP",
          app_protocol: dissection.app_protocol,
          service: dissection.service,
          summary: layer.info,
          fields: { ...dissection.fields, "wlan.decrypted": "true", "wlan.ssid": ssid },
          risk_tags: dissection.risk_tags,
          length: plain.length - 8,
        });
        if (records.length > 20000) break;
      }
      if (matched === 0) {
        notes.push(`Handshake ${label}: keys derived but no frame decrypted — check the passphrase and SSID.`);
      }
    }
  }

  void dissectPayload;

  return {
    records,
    encryptedFrames,
    decryptedFrames,
    handshakes: usable.map(([label]) => label),
    notes: notes.slice(0, 10),
  };
}
