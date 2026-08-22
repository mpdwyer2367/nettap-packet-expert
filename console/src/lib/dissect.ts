/**
 * Application / network protocol dissection.
 *
 * Runs in the browser next to the pcap decoder: raw payload bytes are examined
 * just long enough to pull out the fields an analyst actually asks about
 * (DNS names, HTTP hosts, TLS SNI, SMB shares, SIP call ids, BGP prefixes...),
 * then the bytes are dropped. Only the decoded fields travel to the backend.
 */

export type DissectResult = {
  app_protocol: string | null;
  service: string | null;
  summary: string | null;
  fields: Record<string, string>;
  risk_tags: string[];
};

export const EMPTY_DISSECTION: DissectResult = {
  app_protocol: null,
  service: null,
  summary: null,
  fields: {},
  risk_tags: [],
};

/** Risk vocabulary shared by the dissectors, the tools and the report playbooks. */
export const RISK_TAGS = {
  cleartextCredentials: "cleartext-credentials",
  remoteAdmin: "remote-admin",
  identity: "identity-attack-surface",
  c2Exfil: "c2-exfil-candidate",
  datastore: "exposed-datastore",
  telemetry: "telemetry-integrity",
  email: "email-abuse",
  webAdmin: "web-admin-console",
  nonStandardPort: "non-standard-port",
  legacy: "legacy-protocol",
  weakCrypto: "weak-crypto",
} as const;

export const RISK_TAG_NOTES: Record<string, string> = {
  [RISK_TAGS.cleartextCredentials]:
    "Credentials or session content travel in the clear and can be read from any capture point on the path.",
  [RISK_TAGS.remoteAdmin]:
    "Interactive remote administration — a primary initial-access and lateral-movement path.",
  [RISK_TAGS.identity]:
    "Active Directory / identity infrastructure — target for Kerberoasting, ticket forgery and directory dumps.",
  [RISK_TAGS.c2Exfil]:
    "Common command-and-control and data-exfiltration channel; inspect volume, timing regularity and destinations.",
  [RISK_TAGS.datastore]: "Database or search datastore reachable over the network.",
  [RISK_TAGS.telemetry]:
    "Defensive telemetry stream — breaks in this traffic can mean an intruder cut off logging.",
  [RISK_TAGS.email]: "Mail transport — watch for phishing relays, BEC and outbound exfiltration.",
  [RISK_TAGS.webAdmin]: "Alternate web/admin console port — often a forgotten or unpatched service.",
  [RISK_TAGS.nonStandardPort]:
    "The protocol was seen on a port it does not belong on, which can indicate evasion or tunneling.",
  [RISK_TAGS.legacy]: "Legacy protocol that should normally be retired.",
  [RISK_TAGS.weakCrypto]: "Weak or obsolete cryptography negotiated.",
};

type ServiceEntry = { service: string; risk: string[] };

/** The investigation-critical port map. */
export const PORT_SERVICES: Record<number, ServiceEntry> = {
  21: { service: "FTP", risk: [RISK_TAGS.cleartextCredentials, RISK_TAGS.legacy] },
  22: { service: "SSH", risk: [RISK_TAGS.remoteAdmin] },
  23: { service: "Telnet", risk: [RISK_TAGS.cleartextCredentials, RISK_TAGS.remoteAdmin, RISK_TAGS.legacy] },
  25: { service: "SMTP", risk: [RISK_TAGS.email] },
  53: { service: "DNS", risk: [RISK_TAGS.c2Exfil] },
  67: { service: "DHCP", risk: [] },
  68: { service: "DHCP", risk: [] },
  69: { service: "TFTP", risk: [RISK_TAGS.cleartextCredentials, RISK_TAGS.legacy] },
  80: { service: "HTTP", risk: [RISK_TAGS.c2Exfil, RISK_TAGS.cleartextCredentials] },
  88: { service: "Kerberos", risk: [RISK_TAGS.identity] },
  110: { service: "POP3", risk: [RISK_TAGS.cleartextCredentials, RISK_TAGS.email] },
  123: { service: "NTP", risk: [RISK_TAGS.telemetry] },
  135: { service: "MSRPC endpoint mapper", risk: [RISK_TAGS.identity, RISK_TAGS.remoteAdmin] },
  137: { service: "NetBIOS name", risk: [RISK_TAGS.legacy] },
  139: { service: "NetBIOS session", risk: [RISK_TAGS.legacy, RISK_TAGS.identity] },
  143: { service: "IMAP", risk: [RISK_TAGS.cleartextCredentials, RISK_TAGS.email] },
  161: { service: "SNMP", risk: [RISK_TAGS.telemetry] },
  162: { service: "SNMP trap", risk: [RISK_TAGS.telemetry] },
  389: { service: "LDAP", risk: [RISK_TAGS.identity, RISK_TAGS.cleartextCredentials] },
  443: { service: "HTTPS", risk: [RISK_TAGS.c2Exfil] },
  445: { service: "SMB", risk: [RISK_TAGS.identity, RISK_TAGS.remoteAdmin] },
  514: { service: "Syslog", risk: [RISK_TAGS.telemetry] },
  587: { service: "SMTP submission", risk: [RISK_TAGS.email] },
  636: { service: "LDAPS", risk: [RISK_TAGS.identity] },
  1433: { service: "MSSQL", risk: [RISK_TAGS.datastore] },
  1521: { service: "Oracle DB", risk: [RISK_TAGS.datastore] },
  3306: { service: "MySQL", risk: [RISK_TAGS.datastore] },
  3389: { service: "RDP", risk: [RISK_TAGS.remoteAdmin] },
  5060: { service: "SIP", risk: [] },
  5061: { service: "SIP-TLS", risk: [] },
  5432: { service: "PostgreSQL", risk: [RISK_TAGS.datastore] },
  5985: { service: "WinRM", risk: [RISK_TAGS.remoteAdmin, RISK_TAGS.identity] },
  5986: { service: "WinRM (TLS)", risk: [RISK_TAGS.remoteAdmin, RISK_TAGS.identity] },
  8080: { service: "HTTP alt", risk: [RISK_TAGS.webAdmin, RISK_TAGS.c2Exfil] },
  8443: { service: "HTTPS alt", risk: [RISK_TAGS.webAdmin, RISK_TAGS.c2Exfil] },
  9200: { service: "Elasticsearch", risk: [RISK_TAGS.datastore, RISK_TAGS.telemetry] },
  9300: { service: "Elasticsearch transport", risk: [RISK_TAGS.datastore, RISK_TAGS.telemetry] },
};

/** Ports each dissected application protocol is expected on. */
const EXPECTED_PORTS: Record<string, number[]> = {
  DNS: [53, 5353, 5355],
  DHCP: [67, 68],
  HTTP: [80, 8080, 8000, 8008, 5985],
  TLS: [443, 8443, 636, 5986, 993, 995, 465, 5061],
  NTP: [123],
  SNMP: [161, 162],
  Syslog: [514],
  SMB: [445, 139],
  Kerberos: [88, 464],
  LDAP: [389, 3268],
  MSRPC: [135],
  RDP: [3389],
  SIP: [5060, 5061],
  BGP: [179],
  Telnet: [23],
  SSH: [22],
  SMTP: [25, 587, 465],
  MSSQL: [1433],
  MySQL: [3306],
  Elasticsearch: [9200, 9300],
};

export function serviceForPorts(srcPort: number | null, dstPort: number | null): ServiceEntry | null {
  for (const port of [dstPort, srcPort]) {
    if (port === null || port === undefined) continue;
    const entry = PORT_SERVICES[port];
    if (entry) return entry;
  }
  return null;
}

const decoder = new TextDecoder("utf-8", { fatal: false });

function text(bytes: Uint8Array, start = 0, length = bytes.length - start) {
  return decoder.decode(bytes.subarray(start, Math.min(bytes.length, start + length)));
}

function printable(value: string) {
  return value.replace(/[^\x20-\x7e]/g, "").trim();
}

function u16(bytes: Uint8Array, offset: number) {
  return bytes.length > offset + 1 ? (bytes[offset]! << 8) | bytes[offset + 1]! : 0;
}

function u32(bytes: Uint8Array, offset: number) {
  return bytes.length > offset + 3
    ? ((bytes[offset]! << 24) >>> 0) + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!
    : 0;
}

/* ------------------------------------------------------------------ DNS */

const DNS_TYPES: Record<number, string> = {
  1: "A",
  2: "NS",
  5: "CNAME",
  6: "SOA",
  12: "PTR",
  15: "MX",
  16: "TXT",
  28: "AAAA",
  33: "SRV",
  65: "HTTPS",
  255: "ANY",
};

const DNS_RCODES: Record<number, string> = {
  0: "NOERROR",
  1: "FORMERR",
  2: "SERVFAIL",
  3: "NXDOMAIN",
  4: "NOTIMP",
  5: "REFUSED",
};

function readName(bytes: Uint8Array, offset: number): { name: string; next: number } {
  const labels: string[] = [];
  let cursor = offset;
  let next = -1;
  let guard = 0;
  while (cursor < bytes.length && guard < 64) {
    const length = bytes[cursor]!;
    if (length === 0) {
      cursor += 1;
      break;
    }
    if ((length & 0xc0) === 0xc0) {
      if (next === -1) next = cursor + 2;
      cursor = ((length & 0x3f) << 8) | (bytes[cursor + 1] ?? 0);
      guard += 1;
      continue;
    }
    labels.push(printable(text(bytes, cursor + 1, length)));
    cursor += length + 1;
    guard += 1;
  }
  return { name: labels.join("."), next: next === -1 ? cursor : next };
}

function labelEntropy(name: string) {
  const label = name.split(".")[0] ?? "";
  if (label.length < 8) return 0;
  const counts = new Map<string, number>();
  for (const character of label) counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / label.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function dissectDns(bytes: Uint8Array): DissectResult | null {
  if (bytes.length < 12) return null;
  const flags = u16(bytes, 2);
  const questions = u16(bytes, 4);
  const answers = u16(bytes, 6);
  if (questions === 0 && answers === 0) return null;
  const response = (flags & 0x8000) !== 0;
  const rcode = flags & 0x0f;

  const fields: Record<string, string> = {
    "dns.id": String(u16(bytes, 0)),
    "dns.flags": response ? "response" : "query",
    "dns.questions": String(questions),
    "dns.answers": String(answers),
    "dns.rcode": DNS_RCODES[rcode] ?? String(rcode),
  };

  let name = "";
  let type = "";
  if (questions > 0) {
    const parsed = readName(bytes, 12);
    name = parsed.name;
    type = DNS_TYPES[u16(bytes, parsed.next)] ?? String(u16(bytes, parsed.next));
    fields["dns.qry.name"] = name;
    fields["dns.qry.type"] = type;
  }

  const risk: string[] = [];
  const entropy = labelEntropy(name);
  if (name.length > 60) risk.push(RISK_TAGS.c2Exfil);
  if (entropy >= 3.6) {
    risk.push(RISK_TAGS.c2Exfil);
    fields["dns.label_entropy"] = entropy.toFixed(2);
  }
  if (type === "TXT" || type === "NULL") fields["dns.tunnel_candidate"] = "true";
  if (rcode === 3) fields["dns.nxdomain"] = "true";

  return {
    app_protocol: "DNS",
    service: "DNS",
    summary: `${response ? "Response" : "Query"} ${type ? `${type} ` : ""}${name}${
      response && rcode ? ` (${DNS_RCODES[rcode] ?? rcode})` : ""
    }`.trim(),
    fields,
    risk_tags: risk,
  };
}

/* ----------------------------------------------------------------- DHCP */

const DHCP_TYPES: Record<number, string> = {
  1: "DISCOVER",
  2: "OFFER",
  3: "REQUEST",
  4: "DECLINE",
  5: "ACK",
  6: "NAK",
  7: "RELEASE",
  8: "INFORM",
};

function dissectDhcp(bytes: Uint8Array): DissectResult | null {
  if (bytes.length < 240 || u32(bytes, 236) !== 0x63825363) return null;
  const fields: Record<string, string> = {};
  let messageType = "";
  let cursor = 240;
  while (cursor + 1 < bytes.length) {
    const option = bytes[cursor]!;
    if (option === 255) break;
    if (option === 0) {
      cursor += 1;
      continue;
    }
    const length = bytes[cursor + 1]!;
    const value = bytes.subarray(cursor + 2, cursor + 2 + length);
    if (option === 53) messageType = DHCP_TYPES[value[0] ?? 0] ?? String(value[0]);
    if (option === 12) fields["dhcp.hostname"] = printable(text(value));
    if (option === 50 && length === 4) fields["dhcp.requested_ip"] = value.join(".");
    if (option === 51 && length === 4) fields["dhcp.lease_seconds"] = String(u32(value, 0));
    if (option === 60) fields["dhcp.vendor_class"] = printable(text(value));
    if (option === 55) fields["dhcp.param_request_list"] = [...value].join(",");
    cursor += 2 + length;
  }
  const clientMac = [...bytes.subarray(28, 34)].map((b) => b.toString(16).padStart(2, "0")).join(":");
  fields["dhcp.client_mac"] = clientMac;
  if (messageType) fields["dhcp.type"] = messageType;
  return {
    app_protocol: "DHCP",
    service: "DHCP",
    summary: `DHCP ${messageType || "message"}${fields["dhcp.hostname"] ? ` from ${fields["dhcp.hostname"]}` : ""}`,
    fields,
    risk_tags: [],
  };
}

/* ----------------------------------------------------------------- HTTP */

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "HEAD",
  "DELETE",
  "OPTIONS",
  "PATCH",
  "TRACE",
  "CONNECT",
  "PROPFIND",
];

/** Dissects an HTTP/1.x request or response out of a payload or decrypted stream. */
export function dissectHttp(body: string): DissectResult | null {
  const firstLine = body.split(/\r?\n/, 1)[0] ?? "";
  const isResponse = /^HTTP\/1\.[01] \d{3}/.test(firstLine);
  const method = HTTP_METHODS.find((candidate) => firstLine.startsWith(`${candidate} `));
  if (!isResponse && !method) return null;

  const fields: Record<string, string> = {};
  const risk: string[] = [];
  const header = (name: string) => {
    const match = new RegExp(`^${name}:\\s*(.+)$`, "im").exec(body);
    return match?.[1]?.trim();
  };

  if (isResponse) {
    const [, status, reason] = /^HTTP\/1\.[01] (\d{3})\s*(.*)$/.exec(firstLine) ?? [];
    if (status) fields["http.response.code"] = status;
    if (reason) fields["http.response.phrase"] = reason.trim();
    const server = header("Server");
    if (server) fields["http.server"] = server;
    const contentType = header("Content-Type");
    if (contentType) fields["http.content_type"] = contentType;
  } else {
    const [, uri] = /^\S+ (\S+) HTTP\/1\.[01]/.exec(firstLine) ?? [];
    fields["http.request.method"] = method!;
    if (uri) fields["http.request.uri"] = uri;
    const host = header("Host");
    if (host) fields["http.host"] = host;
    const agent = header("User-Agent");
    if (agent) fields["http.user_agent"] = agent;
    const auth = header("Authorization");
    if (auth) {
      fields["http.authorization"] = auth.split(" ")[0] ?? "present";
      if (/^basic/i.test(auth)) risk.push(RISK_TAGS.cleartextCredentials);
    }
    const cookie = header("Cookie");
    if (cookie) fields["http.cookie_present"] = "true";
  }

  const summary = isResponse
    ? `HTTP ${fields["http.response.code"] ?? ""} ${fields["http.response.phrase"] ?? ""}`.trim()
    : `HTTP ${fields["http.request.method"]} ${fields["http.host"] ?? ""}${fields["http.request.uri"] ?? ""}`.trim();

  return { app_protocol: "HTTP", service: "HTTP", summary, fields, risk_tags: risk };
}

/* ------------------------------------------------------------------ TLS */

const TLS_VERSIONS: Record<number, string> = {
  0x0300: "SSL 3.0",
  0x0301: "TLS 1.0",
  0x0302: "TLS 1.1",
  0x0303: "TLS 1.2",
  0x0304: "TLS 1.3",
};

const TLS_HANDSHAKE_TYPES: Record<number, string> = {
  1: "Client Hello",
  2: "Server Hello",
  11: "Certificate",
  12: "Server Key Exchange",
  14: "Server Hello Done",
  16: "Client Key Exchange",
  4: "New Session Ticket",
};

function readSni(bytes: Uint8Array, start: number, end: number): string | null {
  let cursor = start;
  while (cursor + 4 <= end) {
    const type = u16(bytes, cursor);
    const length = u16(bytes, cursor + 2);
    if (type === 0 && cursor + 4 + length <= end) {
      // server_name extension: list length (2) + type (1) + name length (2)
      const nameLength = u16(bytes, cursor + 7);
      return printable(text(bytes, cursor + 9, nameLength));
    }
    cursor += 4 + length;
  }
  return null;
}

/** Best-effort certificate subject/issuer CN extraction from a DER blob. */
function readCommonNames(bytes: Uint8Array, start: number, end: number) {
  const names: string[] = [];
  for (let index = start; index + 2 < end && index + 2 < bytes.length; index += 1) {
    // OID 2.5.4.3 (commonName) = 55 04 03, followed by a string tag + length.
    if (bytes[index] === 0x55 && bytes[index + 1] === 0x04 && bytes[index + 2] === 0x03) {
      const tag = bytes[index + 3];
      if (tag === 0x0c || tag === 0x13 || tag === 0x16) {
        const length = bytes[index + 4] ?? 0;
        const value = printable(text(bytes, index + 5, length));
        if (value && !names.includes(value)) names.push(value);
      }
    }
  }
  return names;
}

function dissectTls(bytes: Uint8Array): DissectResult | null {
  if (bytes.length < 6) return null;
  const contentType = bytes[0]!;
  if (contentType < 20 || contentType > 24) return null;
  const recordVersion = u16(bytes, 1);
  if (!TLS_VERSIONS[recordVersion]) return null;

  const fields: Record<string, string> = { "tls.record.version": TLS_VERSIONS[recordVersion]! };
  const risk: string[] = [];
  let summary = "TLS record";

  if (contentType === 22 && bytes.length > 9) {
    const handshakeType = bytes[5]!;
    const label = TLS_HANDSHAKE_TYPES[handshakeType] ?? `Handshake ${handshakeType}`;
    fields["tls.handshake.type"] = label;
    summary = `TLS ${label}`;

    if (handshakeType === 1 || handshakeType === 2) {
      const version = u16(bytes, 9);
      if (TLS_VERSIONS[version]) fields["tls.handshake.version"] = TLS_VERSIONS[version]!;
      if (version <= 0x0301) risk.push(RISK_TAGS.weakCrypto);
      // client hello: version(2) random(32) session id
      let cursor = 11 + 32;
      const sessionLength = bytes[cursor] ?? 0;
      cursor += 1 + sessionLength;
      if (handshakeType === 1) {
        const cipherLength = u16(bytes, cursor);
        const ciphers: string[] = [];
        for (let index = 0; index < cipherLength && index < 64; index += 2) {
          ciphers.push(u16(bytes, cursor + 2 + index).toString(16).padStart(4, "0"));
        }
        fields["tls.ciphers"] = ciphers.join(",");
        // Wireshark-style JA3 fingerprint material: version + ciphers.
        fields["tls.ja3_material"] = `${version},${ciphers.join("-")}`;
        cursor += 2 + cipherLength;
        const compressionLength = bytes[cursor] ?? 0;
        cursor += 1 + compressionLength;
        const extensionsLength = u16(bytes, cursor);
        const sni = readSni(bytes, cursor + 2, cursor + 2 + extensionsLength);
        if (sni) {
          fields["tls.sni"] = sni;
          summary = `TLS Client Hello ${sni}`;
        }
      } else {
        fields["tls.cipher"] = u16(bytes, cursor).toString(16).padStart(4, "0");
      }
    }

    if (handshakeType === 11) {
      const names = readCommonNames(bytes, 9, Math.min(bytes.length, 4096));
      if (names.length) {
        fields["tls.certificate.cn"] = names.slice(0, 4).join(", ");
        summary = `TLS Certificate ${names[0]}`;
      }
    }
  } else if (contentType === 23) {
    summary = "TLS application data (encrypted)";
    fields["tls.encrypted"] = "true";
  } else if (contentType === 21) {
    summary = "TLS alert";
  }

  return { app_protocol: "TLS", service: "TLS", summary, fields, risk_tags: risk };
}

/* ------------------------------------------------- other UDP/TCP protocols */

function dissectNtp(bytes: Uint8Array): DissectResult | null {
  if (bytes.length < 48) return null;
  const first = bytes[0]!;
  const version = (first >> 3) & 0x07;
  if (version < 1 || version > 4) return null;
  const mode = first & 0x07;
  const modes = ["reserved", "symmetric active", "symmetric passive", "client", "server", "broadcast", "control", "private"];
  return {
    app_protocol: "NTP",
    service: "NTP",
    summary: `NTP v${version} ${modes[mode] ?? mode}`,
    fields: {
      "ntp.version": String(version),
      "ntp.mode": modes[mode] ?? String(mode),
      "ntp.stratum": String(bytes[1]),
    },
    risk_tags: mode === 7 || mode === 6 ? [RISK_TAGS.telemetry] : [],
  };
}

function dissectSnmp(bytes: Uint8Array): DissectResult | null {
  if (bytes.length < 8 || bytes[0] !== 0x30) return null;
  // SEQUENCE -> INTEGER version -> OCTET STRING community
  let cursor = 1;
  const seqLength = bytes[cursor]!;
  cursor += seqLength & 0x80 ? 1 + (seqLength & 0x7f) : 1;
  if (bytes[cursor] !== 0x02) return null;
  const versionLength = bytes[cursor + 1]!;
  const versionByte = bytes[cursor + 1 + versionLength]!;
  cursor += 2 + versionLength;
  const versions: Record<number, string> = { 0: "v1", 1: "v2c", 3: "v3" };
  const version = versions[versionByte] ?? "v?";
  const fields: Record<string, string> = { "snmp.version": version };
  const risk: string[] = [RISK_TAGS.telemetry];
  if (bytes[cursor] === 0x04) {
    const length = bytes[cursor + 1]!;
    const community = printable(text(bytes, cursor + 2, length));
    if (community) {
      fields["snmp.community"] = community;
      if (version !== "v3") risk.push(RISK_TAGS.cleartextCredentials);
    }
  }
  if (version !== "v3") risk.push(RISK_TAGS.legacy);
  return {
    app_protocol: "SNMP",
    service: "SNMP",
    summary: `SNMP ${version}${fields["snmp.community"] ? ` community "${fields["snmp.community"]}"` : ""}`,
    fields,
    risk_tags: risk,
  };
}

function dissectSyslog(body: string): DissectResult | null {
  const match = /^<(\d{1,3})>/.exec(body);
  if (!match) return null;
  const priority = Number(match[1]);
  const severities = ["emerg", "alert", "crit", "err", "warning", "notice", "info", "debug"];
  return {
    app_protocol: "Syslog",
    service: "Syslog",
    summary: `Syslog ${severities[priority % 8]}: ${printable(body.slice(match[0].length)).slice(0, 120)}`,
    fields: {
      "syslog.priority": String(priority),
      "syslog.facility": String(Math.floor(priority / 8)),
      "syslog.severity": severities[priority % 8] ?? "",
      "syslog.message": printable(body.slice(match[0].length)).slice(0, 400),
    },
    risk_tags: [RISK_TAGS.telemetry],
  };
}

const SMB2_COMMANDS: Record<number, string> = {
  0: "Negotiate",
  1: "Session Setup",
  2: "Logoff",
  3: "Tree Connect",
  4: "Tree Disconnect",
  5: "Create",
  6: "Close",
  8: "Read",
  9: "Write",
  14: "Query Directory",
  16: "Query Info",
};

function dissectSmb(bytes: Uint8Array): DissectResult | null {
  // NetBIOS session service prefix (4 bytes) is common on 445/139.
  const offsets = [0, 4];
  for (const offset of offsets) {
    const marker = bytes.subarray(offset, offset + 4);
    const isSmb2 = marker[0] === 0xfe && marker[1] === 0x53 && marker[2] === 0x4d && marker[3] === 0x42;
    const isSmb1 = marker[0] === 0xff && marker[1] === 0x53 && marker[2] === 0x4d && marker[3] === 0x42;
    if (!isSmb2 && !isSmb1) continue;
    if (isSmb1) {
      return {
        app_protocol: "SMB",
        service: "SMB",
        summary: "SMB1 message (legacy dialect)",
        fields: { "smb.version": "1" },
        risk_tags: [RISK_TAGS.legacy, RISK_TAGS.identity, RISK_TAGS.remoteAdmin],
      };
    }
    const command = bytes[offset + 12]! | (bytes[offset + 13]! << 8);
    const label = SMB2_COMMANDS[command] ?? `Command ${command}`;
    const fields: Record<string, string> = { "smb.version": "2", "smb2.command": label };
    // UTF-16LE share/file names sit after the fixed header for Tree Connect / Create.
    const tail = bytes.subarray(offset + 64, Math.min(bytes.length, offset + 512));
    let name = "";
    for (let index = 0; index + 1 < tail.length; index += 2) {
      const code = tail[index]! | (tail[index + 1]! << 8);
      if (code >= 0x20 && code <= 0x7e) name += String.fromCharCode(code);
      else if (name.length >= 4) break;
      else name = "";
    }
    if (name.length >= 4) fields[command === 3 ? "smb2.tree" : "smb2.filename"] = name;
    return {
      app_protocol: "SMB",
      service: "SMB",
      summary: `SMB2 ${label}${name.length >= 4 ? ` ${name}` : ""}`,
      fields,
      risk_tags: [RISK_TAGS.identity, RISK_TAGS.remoteAdmin],
    };
  }
  return null;
}

const KRB_MESSAGE_TYPES: Record<number, string> = {
  10: "AS-REQ",
  11: "AS-REP",
  12: "TGS-REQ",
  13: "TGS-REP",
  30: "KRB-ERROR",
};

const KRB_ETYPES: Record<number, string> = {
  1: "des-cbc-crc",
  3: "des-cbc-md5",
  17: "aes128-cts-hmac-sha1-96",
  18: "aes256-cts-hmac-sha1-96",
  23: "rc4-hmac",
};

function dissectKerberos(bytes: Uint8Array): DissectResult | null {
  // APPLICATION tags 10..13 / 30 appear as 0x6a..0x6d / 0x7e in the DER header.
  const head = bytes[0] ?? 0;
  const appTag = head & 0x1f;
  if ((head & 0xe0) !== 0x60 || ![10, 11, 12, 13, 30].includes(appTag)) return null;
  const label = KRB_MESSAGE_TYPES[appTag] ?? `Kerberos ${appTag}`;
  const fields: Record<string, string> = { "kerberos.msg_type": label };
  const risk: string[] = [RISK_TAGS.identity];

  // Encryption types show up as small INTEGERs after the etype context tag.
  const window = bytes.subarray(0, Math.min(bytes.length, 1024));
  const etypes = new Set<string>();
  for (let index = 0; index + 2 < window.length; index += 1) {
    if (window[index] === 0x02 && window[index + 1] === 0x01) {
      const value = window[index + 2]!;
      if (KRB_ETYPES[value]) etypes.add(KRB_ETYPES[value]!);
    }
  }
  if (etypes.size) {
    fields["kerberos.etypes"] = [...etypes].join(",");
    if ([...etypes].some((etype) => etype.startsWith("rc4") || etype.startsWith("des"))) {
      risk.push(RISK_TAGS.weakCrypto);
    }
  }
  const readable = printable(text(window)).match(/[A-Z0-9.-]{4,}\.[A-Z]{2,}/);
  if (readable) fields["kerberos.realm"] = readable[0];

  return {
    app_protocol: "Kerberos",
    service: "Kerberos",
    summary: `Kerberos ${label}${fields["kerberos.realm"] ? ` realm ${fields["kerberos.realm"]}` : ""}`,
    fields,
    risk_tags: risk,
  };
}

const LDAP_OPS: Record<number, string> = {
  0: "bindRequest",
  1: "bindResponse",
  2: "unbindRequest",
  3: "searchRequest",
  4: "searchResEntry",
  5: "searchResDone",
  6: "modifyRequest",
  8: "addRequest",
  10: "delRequest",
};

function dissectLdap(bytes: Uint8Array): DissectResult | null {
  if (bytes[0] !== 0x30 || bytes.length < 7) return null;
  let cursor = 1;
  const length = bytes[cursor]!;
  cursor += length & 0x80 ? 1 + (length & 0x7f) : 1;
  if (bytes[cursor] !== 0x02) return null; // messageID
  cursor += 2 + bytes[cursor + 1]!;
  const opTag = bytes[cursor];
  if (opTag === undefined || (opTag & 0xc0) !== 0x40) return null;
  const op = LDAP_OPS[opTag & 0x1f];
  if (!op) return null;
  const fields: Record<string, string> = { "ldap.operation": op };
  const risk: string[] = [RISK_TAGS.identity];
  const readable = printable(text(bytes.subarray(cursor, Math.min(bytes.length, cursor + 400))));
  const dnText = readable.split(String.fromCharCode(0), 1)[0] ?? "";
  const dn = dnText.match(/(?:CN|DC|OU)=.{3,120}/i);
  if (dn) fields[op === "searchRequest" ? "ldap.base_dn" : "ldap.dn"] = dn[0];
  if (
    op === "bindRequest" &&
    text(bytes.subarray(cursor, cursor + 200)).includes(String.fromCharCode(0x80))
  ) {
    fields["ldap.simple_bind"] = "true";
    risk.push(RISK_TAGS.cleartextCredentials);
  }
  return {
    app_protocol: "LDAP",
    service: "LDAP",
    summary: `LDAP ${op}${dn ? ` ${dn[0]}` : ""}`,
    fields,
    risk_tags: risk,
  };
}

function dissectRdp(bytes: Uint8Array): DissectResult | null {
  // TPKT header version 3 + X.224 connection PDU.
  if (bytes[0] !== 0x03 || bytes[1] !== 0x00 || bytes.length < 7) return null;
  const x224Type = bytes[5]! & 0xf0;
  const kinds: Record<number, string> = { 0xe0: "Connection Request", 0xd0: "Connection Confirm", 0xf0: "Data" };
  const fields: Record<string, string> = { "rdp.x224": kinds[x224Type] ?? `0x${x224Type.toString(16)}` };
  const cookie = printable(text(bytes.subarray(7, Math.min(bytes.length, 160)))).match(/Cookie: mstshash=([^\s]+)/);
  if (cookie?.[1]) fields["rdp.cookie_user"] = cookie[1];
  return {
    app_protocol: "RDP",
    service: "RDP",
    summary: `RDP ${fields["rdp.x224"]}${cookie?.[1] ? ` user ${cookie[1]}` : ""}`,
    fields,
    risk_tags: [RISK_TAGS.remoteAdmin],
  };
}

function dissectMsrpc(bytes: Uint8Array): DissectResult | null {
  if (bytes[0] !== 0x05 || (bytes[1] !== 0x00 && bytes[1] !== 0x01)) return null;
  const types: Record<number, string> = { 0: "Request", 2: "Response", 11: "Bind", 12: "Bind Ack", 14: "Bind Nak" };
  const type = types[bytes[2] ?? 0] ?? `PDU ${bytes[2]}`;
  return {
    app_protocol: "MSRPC",
    service: "MSRPC endpoint mapper",
    summary: `DCERPC ${type}`,
    fields: { "dcerpc.pdu": type, "dcerpc.version": `${bytes[0]}.${bytes[1]}` },
    risk_tags: [RISK_TAGS.identity, RISK_TAGS.remoteAdmin],
  };
}

const SIP_METHODS = ["INVITE", "ACK", "BYE", "CANCEL", "REGISTER", "OPTIONS", "SUBSCRIBE", "NOTIFY", "INFO"];

function dissectSip(body: string): DissectResult | null {
  const firstLine = body.split(/\r?\n/, 1)[0] ?? "";
  const isResponse = /^SIP\/2\.0 \d{3}/.test(firstLine);
  const method = SIP_METHODS.find((candidate) => firstLine.startsWith(`${candidate} `));
  if (!isResponse && !method) return null;
  const header = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, "im").exec(body)?.[1]?.trim();
  const fields: Record<string, string> = {};
  if (isResponse) fields["sip.status"] = firstLine.replace("SIP/2.0 ", "");
  else fields["sip.method"] = method!;
  const from = header("From") ?? header("f");
  const to = header("To") ?? header("t");
  const callId = header("Call-ID") ?? header("i");
  if (from) fields["sip.from"] = from;
  if (to) fields["sip.to"] = to;
  if (callId) fields["sip.call_id"] = callId;
  return {
    app_protocol: "SIP",
    service: "SIP",
    summary: `SIP ${isResponse ? fields["sip.status"] : method} ${to ?? ""}`.trim(),
    fields,
    risk_tags: [],
  };
}

function dissectRtp(bytes: Uint8Array, dstPort: number | null): DissectResult | null {
  if (bytes.length < 12) return null;
  if ((bytes[0]! >> 6) !== 2) return null;
  const payloadType = bytes[1]! & 0x7f;
  if (payloadType > 34 && payloadType < 96) return null;
  if (dstPort !== null && dstPort < 1024) return null;
  const names: Record<number, string> = { 0: "PCMU", 3: "GSM", 8: "PCMA", 9: "G722", 18: "G729", 26: "JPEG", 34: "H263" };
  return {
    app_protocol: "RTP",
    service: "RTP media",
    summary: `RTP ${names[payloadType] ?? `PT ${payloadType}`} seq ${u16(bytes, 2)}`,
    fields: {
      "rtp.payload_type": names[payloadType] ?? String(payloadType),
      "rtp.sequence": String(u16(bytes, 2)),
      "rtp.timestamp": String(u32(bytes, 4)),
      "rtp.ssrc": u32(bytes, 8).toString(16),
    },
    risk_tags: [],
  };
}

function dissectBgp(bytes: Uint8Array): DissectResult | null {
  // 16 bytes of 0xff marker.
  for (let index = 0; index < 16; index += 1) if (bytes[index] !== 0xff) return null;
  const types: Record<number, string> = { 1: "OPEN", 2: "UPDATE", 3: "NOTIFICATION", 4: "KEEPALIVE" };
  const type = types[bytes[18] ?? 0] ?? `type ${bytes[18]}`;
  const fields: Record<string, string> = { "bgp.type": type };
  if (bytes[18] === 1) {
    fields["bgp.version"] = String(bytes[19]);
    fields["bgp.my_as"] = String(u16(bytes, 20));
    fields["bgp.hold_time"] = String(u16(bytes, 22));
    fields["bgp.identifier"] = [...bytes.subarray(24, 28)].join(".");
  }
  return {
    app_protocol: "BGP",
    service: "BGP",
    summary: `BGP ${type}${fields["bgp.my_as"] ? ` AS${fields["bgp.my_as"]}` : ""}`,
    fields,
    risk_tags: [],
  };
}

function dissectOspf(bytes: Uint8Array): DissectResult | null {
  if (bytes.length < 24 || bytes[0] !== 2) return null;
  const types: Record<number, string> = { 1: "Hello", 2: "DB Description", 3: "LS Request", 4: "LS Update", 5: "LS Ack" };
  const type = types[bytes[1] ?? 0] ?? `type ${bytes[1]}`;
  return {
    app_protocol: "OSPF",
    service: "OSPF",
    summary: `OSPFv2 ${type} area ${[...bytes.subarray(12, 16)].join(".")}`,
    fields: {
      "ospf.type": type,
      "ospf.router_id": [...bytes.subarray(4, 8)].join("."),
      "ospf.area": [...bytes.subarray(12, 16)].join("."),
    },
    risk_tags: [],
  };
}

function dissectVrrp(bytes: Uint8Array): DissectResult | null {
  if (bytes.length < 8) return null;
  const version = bytes[0]! >> 4;
  if (version < 2 || version > 3) return null;
  return {
    app_protocol: "VRRP",
    service: "VRRP",
    summary: `VRRP v${version} advertisement VRID ${bytes[1]} priority ${bytes[2]}`,
    fields: {
      "vrrp.version": String(version),
      "vrrp.vrid": String(bytes[1]),
      "vrrp.priority": String(bytes[2]),
    },
    risk_tags: [],
  };
}

/* ------------------------------------------------------- link-layer decodes */

const LLDP_TLVS: Record<number, string> = { 1: "chassis_id", 2: "port_id", 4: "port_description", 5: "system_name", 6: "system_description" };

function dissectLldp(bytes: Uint8Array): DissectResult {
  const fields: Record<string, string> = {};
  let cursor = 0;
  while (cursor + 2 <= bytes.length) {
    const header = u16(bytes, cursor);
    const type = header >> 9;
    const length = header & 0x1ff;
    if (type === 0) break;
    const name = LLDP_TLVS[type];
    if (name) {
      const raw = bytes.subarray(cursor + 2, cursor + 2 + length);
      const value = printable(text(type === 1 || type === 2 ? raw.subarray(1) : raw));
      if (value) fields[`lldp.${name}`] = value.slice(0, 120);
    }
    cursor += 2 + length;
  }
  return {
    app_protocol: "LLDP",
    service: "LLDP",
    summary: `LLDP neighbour ${fields["lldp.system_name"] ?? fields["lldp.chassis_id"] ?? "advertisement"}${
      fields["lldp.port_id"] ? ` port ${fields["lldp.port_id"]}` : ""
    }`,
    fields,
    risk_tags: [],
  };
}

function dissectCdp(bytes: Uint8Array): DissectResult {
  const fields: Record<string, string> = {};
  const names: Record<number, string> = { 1: "device_id", 3: "port_id", 4: "capabilities", 5: "software_version", 6: "platform", 10: "native_vlan" };
  let cursor = 4;
  while (cursor + 4 <= bytes.length) {
    const type = u16(bytes, cursor);
    const length = u16(bytes, cursor + 2);
    if (length < 4) break;
    const name = names[type];
    if (name) {
      const value = printable(text(bytes, cursor + 4, length - 4));
      if (value) fields[`cdp.${name}`] = value.slice(0, 120);
    }
    cursor += length;
  }
  return {
    app_protocol: "CDP",
    service: "CDP",
    summary: `CDP neighbour ${fields["cdp.device_id"] ?? ""} ${fields["cdp.port_id"] ?? ""}`.trim(),
    fields,
    risk_tags: [],
  };
}

/** Dissects LLDP / CDP frames that never reach the IP layer. */
export function dissectLinkLayer(etherType: number, payload: Uint8Array): DissectResult | null {
  if (etherType === 0x88cc) return dissectLldp(payload);
  // CDP rides on SNAP with OUI 00-00-0c, PID 0x2000.
  if (etherType === 0x2000) return dissectCdp(payload);
  return null;
}

/* ---------------------------------------------------------------- dispatch */

function textProbe(bytes: Uint8Array) {
  return text(bytes, 0, Math.min(bytes.length, 2048));
}

/**
 * Dissects a transport payload. `ipProto` is the IP protocol number, so
 * non-TCP/UDP control-plane protocols (OSPF, VRRP) are handled too.
 */
export function dissectPayload(input: {
  ipProto: number;
  srcPort: number | null;
  dstPort: number | null;
  payload: Uint8Array;
}): DissectResult {
  const { ipProto, srcPort, dstPort, payload } = input;
  const service = serviceForPorts(srcPort, dstPort);
  const base: DissectResult = {
    app_protocol: null,
    service: service?.service ?? null,
    summary: null,
    fields: {},
    risk_tags: service ? [...service.risk] : [],
  };

  if (ipProto === 89) return finish(base, dissectOspf(payload), srcPort, dstPort);
  if (ipProto === 112) return finish(base, dissectVrrp(payload), srcPort, dstPort);
  if (payload.length === 0) return base;

  const ports = [srcPort, dstPort].filter((port): port is number => port !== null);
  const has = (...candidates: number[]) => candidates.some((port) => ports.includes(port));

  let result: DissectResult | null = null;

  if (ipProto === 17) {
    if (has(53, 5353, 5355)) result = dissectDns(payload);
    if (!result && has(67, 68)) result = dissectDhcp(payload);
    if (!result && has(123)) result = dissectNtp(payload);
    if (!result && has(161, 162)) result = dissectSnmp(payload);
    if (!result && has(514)) result = dissectSyslog(textProbe(payload));
    if (!result && has(5060)) result = dissectSip(textProbe(payload));
    if (!result) result = dissectRtp(payload, dstPort);
    if (!result) result = dissectDns(payload);
  } else if (ipProto === 6) {
    const probe = textProbe(payload);
    if (has(445, 139)) result = dissectSmb(payload);
    if (!result && has(88, 464)) result = dissectKerberos(payload);
    if (!result && has(389, 3268)) result = dissectLdap(payload);
    if (!result && has(135)) result = dissectMsrpc(payload);
    if (!result && has(3389)) result = dissectRdp(payload);
    if (!result && has(179)) result = dissectBgp(payload);
    if (!result) result = dissectHttp(probe);
    if (!result) result = dissectTls(payload);
    if (!result && has(5060, 5061)) result = dissectSip(probe);
    if (!result && has(23)) {
      result = {
        app_protocol: "Telnet",
        service: "Telnet",
        summary: `Telnet data: ${printable(probe).slice(0, 80)}`,
        fields: { "telnet.data": printable(probe).slice(0, 200) },
        risk_tags: [RISK_TAGS.cleartextCredentials, RISK_TAGS.legacy],
      };
    }
    if (!result && has(22) && probe.startsWith("SSH-")) {
      result = {
        app_protocol: "SSH",
        service: "SSH",
        summary: `SSH banner ${printable(probe.split(/\r?\n/, 1)[0] ?? "")}`,
        fields: { "ssh.banner": printable(probe.split(/\r?\n/, 1)[0] ?? "") },
        risk_tags: [RISK_TAGS.remoteAdmin],
      };
    }
    if (!result && has(25, 587, 110, 143)) {
      const line = printable(probe.split(/\r?\n/, 1)[0] ?? "");
      if (line) {
        result = {
          app_protocol: "SMTP/POP/IMAP",
          service: service?.service ?? "Mail",
          summary: `Mail command: ${line.slice(0, 80)}`,
          fields: { "mail.line": line.slice(0, 200) },
          risk_tags: [RISK_TAGS.email],
        };
      }
    }
    if (!result) result = dissectSmb(payload);
    if (!result) result = dissectTls(payload);
  }

  return finish(base, result, srcPort, dstPort);
}

function finish(
  base: DissectResult,
  result: DissectResult | null,
  srcPort: number | null,
  dstPort: number | null,
): DissectResult {
  if (!result) return base;
  const tags = new Set([...base.risk_tags, ...result.risk_tags]);
  const expected = EXPECTED_PORTS[result.app_protocol ?? ""];
  if (expected && ![srcPort, dstPort].some((port) => port !== null && expected.includes(port))) {
    tags.add(RISK_TAGS.nonStandardPort);
  }
  return {
    app_protocol: result.app_protocol,
    service: result.service ?? base.service,
    summary: result.summary,
    fields: result.fields,
    risk_tags: [...tags],
  };
}

/**
 * Builds the same dissection shape from tshark/Wireshark export fields, so
 * decoded exports and in-browser decodes carry identical metadata.
 */
export function dissectFromFields(
  fields: Record<string, string>,
  ports: { srcPort: number | null; dstPort: number | null },
  columnProtocol: string | null,
): DissectResult {
  const out: Record<string, string> = {};
  const risk = new Set<string>(serviceForPorts(ports.srcPort, ports.dstPort)?.risk ?? []);
  let appProtocol: string | null = null;
  let summary: string | null = null;

  const get = (...names: string[]) => {
    for (const name of names) {
      const flat = name.replace(/\./g, "_");
      const layer = name.split(".")[0] ?? "";
      for (const key of [name, flat, `${layer}_${flat}`]) {
        const value = fields[key];
        if (value) return value;
      }
    }
    return undefined;
  };

  const dnsName = get("dns.qry.name");
  if (dnsName) {
    appProtocol = "DNS";
    out["dns.qry.name"] = dnsName;
    const type = get("dns.qry.type");
    if (type) out["dns.qry.type"] = type;
    const rcode = get("dns.flags.rcode");
    if (rcode && rcode !== "0") out["dns.rcode"] = rcode;
    if (rcode === "3") out["dns.nxdomain"] = "true";
    if (labelEntropy(dnsName) >= 3.6 || dnsName.length > 60) risk.add(RISK_TAGS.c2Exfil);
    summary = `DNS ${type ?? ""} ${dnsName}`.trim();
  }

  const host = get("http.host");
  const method = get("http.request.method");
  const status = get("http.response.code");
  if (host || method || status) {
    appProtocol = "HTTP";
    if (host) out["http.host"] = host;
    if (method) out["http.request.method"] = method;
    if (status) out["http.response.code"] = status;
    const uri = get("http.request.uri", "http.request.full_uri");
    if (uri) out["http.request.uri"] = uri;
    const agent = get("http.user_agent");
    if (agent) out["http.user_agent"] = agent;
    const auth = get("http.authorization", "http.authbasic");
    if (auth) {
      out["http.authorization"] = auth;
      risk.add(RISK_TAGS.cleartextCredentials);
    }
    summary = method ? `HTTP ${method} ${host ?? ""}${uri ?? ""}` : `HTTP ${status ?? ""}`;
  }

  const sni = get("tls.handshake.extensions_server_name");
  const tlsVersion = get("tls.handshake.version", "tls.record.version");
  if (sni || tlsVersion) {
    appProtocol = appProtocol ?? "TLS";
    if (sni) out["tls.sni"] = sni;
    if (tlsVersion) out["tls.version"] = tlsVersion;
    const cert = get("x509sat.printableString", "x509ce.dNSName");
    if (cert) out["tls.certificate.cn"] = cert;
    if (tlsVersion && /0x0301|0x0300|TLSv1\.0|SSLv3/i.test(tlsVersion)) risk.add(RISK_TAGS.weakCrypto);
    summary = summary ?? `TLS ${sni ?? tlsVersion ?? ""}`.trim();
  }

  const smbCommand = get("smb2.cmd", "smb2.filename", "smb.cmd");
  if (smbCommand) {
    appProtocol = "SMB";
    out["smb2.command"] = smbCommand;
    const share = get("smb2.tree");
    if (share) out["smb2.tree"] = share;
    risk.add(RISK_TAGS.identity);
    risk.add(RISK_TAGS.remoteAdmin);
    summary = summary ?? `SMB ${smbCommand}${share ? ` ${share}` : ""}`;
  }

  const krbType = get("kerberos.msg_type");
  if (krbType) {
    appProtocol = "Kerberos";
    out["kerberos.msg_type"] = KRB_MESSAGE_TYPES[Number(krbType)] ?? krbType;
    const etype = get("kerberos.etype");
    if (etype) {
      out["kerberos.etypes"] = KRB_ETYPES[Number(etype)] ?? etype;
      if (Number(etype) === 23 || Number(etype) < 17) risk.add(RISK_TAGS.weakCrypto);
    }
    risk.add(RISK_TAGS.identity);
    summary = summary ?? `Kerberos ${out["kerberos.msg_type"]}`;
  }

  const ldapOp = get("ldap.protocolOp", "ldap.baseObject");
  if (ldapOp) {
    appProtocol = appProtocol ?? "LDAP";
    out["ldap.operation"] = ldapOp;
    risk.add(RISK_TAGS.identity);
  }

  const sipMethod = get("sip.Method", "sip.method", "sip.CSeq");
  if (sipMethod) {
    appProtocol = appProtocol ?? "SIP";
    out["sip.method"] = sipMethod;
    const callId = get("sip.Call-ID", "sip.call_id");
    if (callId) out["sip.call_id"] = callId;
    summary = summary ?? `SIP ${sipMethod}`;
  }

  const rtpSsrc = get("rtp.ssrc");
  if (rtpSsrc) {
    appProtocol = appProtocol ?? "RTP";
    out["rtp.ssrc"] = rtpSsrc;
    const seq = get("rtp.seq");
    if (seq) out["rtp.sequence"] = seq;
  }

  const bgpType = get("bgp.type");
  if (bgpType) {
    appProtocol = "BGP";
    out["bgp.type"] = bgpType;
  }
  const ospfType = get("ospf.msg");
  if (ospfType) {
    appProtocol = "OSPF";
    out["ospf.type"] = ospfType;
  }
  const lldpName = get("lldp.tlv.system.name");
  if (lldpName) {
    appProtocol = "LLDP";
    out["lldp.system_name"] = lldpName;
  }
  const cdpDevice = get("cdp.deviceid");
  if (cdpDevice) {
    appProtocol = "CDP";
    out["cdp.device_id"] = cdpDevice;
  }
  const dhcpType = get("dhcp.option.dhcp", "bootp.option.dhcp");
  if (dhcpType) {
    appProtocol = "DHCP";
    out["dhcp.type"] = DHCP_TYPES[Number(dhcpType)] ?? dhcpType;
    const hostname = get("dhcp.option.hostname", "bootp.option.hostname");
    if (hostname) out["dhcp.hostname"] = hostname;
  }
  const snmpCommunity = get("snmp.community");
  if (snmpCommunity) {
    appProtocol = "SNMP";
    out["snmp.community"] = snmpCommunity;
    risk.add(RISK_TAGS.cleartextCredentials);
    risk.add(RISK_TAGS.telemetry);
  }

  if (!appProtocol && columnProtocol) {
    const upper = columnProtocol.toUpperCase();
    if (["DNS", "HTTP", "TLS", "TLSV1.2", "TLSV1.3", "SMB2", "KRB5", "LDAP", "SIP", "RTP", "BGP", "OSPF", "DHCP", "SNMP", "SYSLOG", "NTP"].includes(upper)) {
      appProtocol = upper.startsWith("TLS") ? "TLS" : upper === "SMB2" ? "SMB" : upper === "KRB5" ? "Kerberos" : upper;
    }
  }

  const expected = EXPECTED_PORTS[appProtocol ?? ""];
  if (expected && ![ports.srcPort, ports.dstPort].some((port) => port !== null && expected.includes(port))) {
    risk.add(RISK_TAGS.nonStandardPort);
  }

  return {
    app_protocol: appProtocol,
    service: serviceForPorts(ports.srcPort, ports.dstPort)?.service ?? appProtocol,
    summary,
    fields: out,
    risk_tags: [...risk],
  };
}
