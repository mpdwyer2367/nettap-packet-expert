/** Canonical normalized flow/packet shapes and the rules that classify them. */

export type FlowRecord = {
  ts: string;
  exporter_ip: string;
  protocol_number: number | null;
  protocol: string | null;
  src_ip: string | null;
  dst_ip: string | null;
  src_port: number | null;
  dst_port: number | null;
  packets: number;
  bytes: number;
  tcp_flags: number | null;
  sampling_rate: number | null;
  ingress_if: number | null;
  egress_if: number | null;
  app_protocol: string | null;
  service: string | null;
  risk_tags: string[];
  vantage: string;
  observation_point: string;
  source: "netflow" | "ipfix" | "sflow";
};

export type PacketRecord = {
  ts: string;
  interface_name: string;
  src_ip: string | null;
  dst_ip: string | null;
  src_port: number | null;
  dst_port: number | null;
  protocol: string | null;
  length: number;
  info: string | null;
  vantage: string;
  observation_point: string;
};

export const PROTOCOL_NAMES: Record<number, string> = {
  1: "icmp",
  2: "igmp",
  6: "tcp",
  17: "udp",
  41: "ipv6",
  47: "gre",
  50: "esp",
  51: "ah",
  58: "icmpv6",
  89: "ospf",
  132: "sctp",
};

export function protocolName(num: number | null | undefined): string | null {
  if (num == null) return null;
  return PROTOCOL_NAMES[num] ?? `proto-${num}`;
}

/** Well-known ports -> {service, appProtocol}. Not exhaustive, just useful. */
const PORT_SERVICES: Record<number, { service: string; app: string }> = {
  20: { service: "ftp-data", app: "ftp" },
  21: { service: "ftp", app: "ftp" },
  22: { service: "ssh", app: "ssh" },
  23: { service: "telnet", app: "telnet" },
  25: { service: "smtp", app: "smtp" },
  53: { service: "dns", app: "dns" },
  67: { service: "dhcp", app: "dhcp" },
  68: { service: "dhcp", app: "dhcp" },
  69: { service: "tftp", app: "tftp" },
  80: { service: "http", app: "http" },
  110: { service: "pop3", app: "pop3" },
  111: { service: "rpcbind", app: "rpc" },
  123: { service: "ntp", app: "ntp" },
  135: { service: "msrpc", app: "rpc" },
  137: { service: "netbios-ns", app: "netbios" },
  138: { service: "netbios-dgm", app: "netbios" },
  139: { service: "netbios-ssn", app: "smb" },
  143: { service: "imap", app: "imap" },
  161: { service: "snmp", app: "snmp" },
  162: { service: "snmptrap", app: "snmp" },
  389: { service: "ldap", app: "ldap" },
  443: { service: "https", app: "tls" },
  445: { service: "microsoft-ds", app: "smb" },
  465: { service: "smtps", app: "smtp" },
  514: { service: "syslog", app: "syslog" },
  515: { service: "printer", app: "lpd" },
  587: { service: "submission", app: "smtp" },
  636: { service: "ldaps", app: "ldap" },
  993: { service: "imaps", app: "imap" },
  995: { service: "pop3s", app: "pop3" },
  1433: { service: "ms-sql", app: "sql" },
  1521: { service: "oracle", app: "sql" },
  1723: { service: "pptp", app: "vpn" },
  1883: { service: "mqtt", app: "mqtt" },
  2049: { service: "nfs", app: "nfs" },
  2375: { service: "docker", app: "docker" },
  3306: { service: "mysql", app: "sql" },
  3389: { service: "rdp", app: "rdp" },
  5060: { service: "sip", app: "sip" },
  5432: { service: "postgres", app: "sql" },
  5900: { service: "vnc", app: "vnc" },
  5985: { service: "winrm-http", app: "winrm" },
  5986: { service: "winrm-https", app: "winrm" },
  6379: { service: "redis", app: "redis" },
  8080: { service: "http-alt", app: "http" },
  8443: { service: "https-alt", app: "tls" },
  9200: { service: "elasticsearch", app: "http" },
  27017: { service: "mongodb", app: "mongo" },
};

export function guessService(port: number | null): { service: string | null; app: string | null } {
  if (port == null) return { service: null, app: null };
  const hit = PORT_SERVICES[port];
  if (hit) return { service: hit.service, app: hit.app };
  if (port < 1024) return { service: `port-${port}`, app: null };
  return { service: null, app: null };
}

const CLEARTEXT_CRED_PORTS = new Set([21, 23, 69, 111, 137, 138, 139, 512, 513, 514]);
const KNOWN_RESOLVERS = new Set(["8.8.8.8", "8.8.4.4", "1.1.1.1", "1.0.0.1", "9.9.9.9"]);

/** Simple, explainable risk tagging — no ML, just well-known bad patterns. */
export function riskTags(input: {
  srcPort: number | null;
  dstPort: number | null;
  protocolNum: number | null;
  dstIp: string | null;
}): string[] {
  const tags: string[] = [];
  const ports = [input.srcPort, input.dstPort].filter((p): p is number => p != null);

  if (ports.includes(23)) tags.push("telnet-cleartext");
  if (ports.includes(21) || ports.includes(20)) tags.push("ftp-cleartext");
  if (ports.includes(139)) tags.push("smb-v1-suspect");
  if (ports.some((p) => CLEARTEXT_CRED_PORTS.has(p))) tags.push("cleartext-credentials-risk");
  if (ports.includes(80)) tags.push("plaintext-http");
  if (ports.includes(53) && input.dstIp && !KNOWN_RESOLVERS.has(input.dstIp)) {
    tags.push("dns-to-nonstandard-resolver");
  }
  if (
    input.dstPort != null &&
    input.dstPort > 1024 &&
    !PORT_SERVICES[input.dstPort] &&
    input.protocolNum === 6
  ) {
    tags.push("unusual-tcp-port");
  }
  return tags;
}

export function normalizeFlow(input: {
  ts: Date;
  exporterIp: string;
  protocolNum: number | null;
  srcIp: string | null;
  dstIp: string | null;
  srcPort: number | null;
  dstPort: number | null;
  packets: number;
  bytes: number;
  tcpFlags: number | null;
  samplingRate: number | null;
  ingressIf: number | null;
  egressIf: number | null;
  vantage: string;
  observationPoint: string;
  source: "netflow" | "ipfix" | "sflow";
}): FlowRecord {
  const { service, app } = guessService(input.dstPort ?? input.srcPort);
  return {
    ts: input.ts.toISOString(),
    exporter_ip: input.exporterIp,
    protocol_number: input.protocolNum,
    protocol: protocolName(input.protocolNum),
    src_ip: input.srcIp,
    dst_ip: input.dstIp,
    src_port: input.srcPort,
    dst_port: input.dstPort,
    packets: input.packets,
    bytes: input.bytes,
    tcp_flags: input.tcpFlags,
    sampling_rate: input.samplingRate,
    ingress_if: input.ingressIf,
    egress_if: input.egressIf,
    app_protocol: app,
    service,
    risk_tags: riskTags({
      srcPort: input.srcPort,
      dstPort: input.dstPort,
      protocolNum: input.protocolNum,
      dstIp: input.dstIp,
    }),
    vantage: input.vantage,
    observation_point: input.observationPoint,
    source: input.source,
  };
}
