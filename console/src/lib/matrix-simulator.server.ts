/**
 * Deterministic MATRIX fabric simulator. Seeded from the connection id so a
 * given simulator connection always produces the same topology shape, while
 * counters vary over time with a diurnal pattern.
 *
 * Server-only (used behind the adapter factory); has no external I/O.
 */
import type {
  MatrixAlarm,
  MatrixConfigRevision,
  MatrixDevice,
  MatrixLink,
  MatrixPolicy,
  MatrixPort,
  MatrixPortCounterSample,
  MatrixSnapshot,
} from "./matrix-types";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SITES = ["dc1-east", "dc2-west"];
const MODELS = ["MATRIX-SW-5200", "MATRIX-SW-3100", "MATRIX-BRK-9000", "MATRIX-TAP-100"];

function deviceId(connectionId: string, key: string) {
  return `${connectionId}:device:${key}`;
}
function portId(connectionId: string, key: string) {
  return `${connectionId}:port:${key}`;
}

export type SimulatedTopology = {
  devices: MatrixDevice[];
  ports: MatrixPort[];
  links: MatrixLink[];
  policies: MatrixPolicy[];
};

/** Builds the (time-invariant) fabric shape for a connection. */
export function buildSimulatedTopology(connectionId: string): SimulatedTopology {
  const rand = mulberry32(seedFromString(connectionId));
  const devices: MatrixDevice[] = [];
  const ports: MatrixPort[] = [];
  const links: MatrixLink[] = [];
  const policies: MatrixPolicy[] = [];

  const now = new Date().toISOString();

  function addDevice(key: string, name: string, site: string, role: string, model: string) {
    const id = deviceId(connectionId, key);
    devices.push({
      id,
      connection_id: connectionId,
      device_key: key,
      name,
      site,
      role,
      model,
      serial: `SN-${seedFromString(key).toString(16).slice(0, 8).toUpperCase()}`,
      os_version: `matrix-os ${1 + Math.floor(rand() * 3)}.${Math.floor(rand() * 9)}.${Math.floor(rand() * 9)}`,
      mgmt_ip: `10.${site === SITES[0] ? 10 : 20}.0.${devices.length + 1}`,
      health_status: "healthy",
      health: { cpu_pct: Math.round(10 + rand() * 30), mem_pct: Math.round(20 + rand() * 40), temp_c: Math.round(30 + rand() * 15) },
      p4_state: role === "broker" ? { pipeline: "ingress->filter->dedup->slice->lb->egress", tables_loaded: 12 + Math.floor(rand() * 6) } : {},
      last_seen_at: now,
    });
    return id;
  }

  function addPort(deviceKey: string, portKey: string, name: string, kind: string, speedGb: number) {
    const id = portId(connectionId, `${deviceKey}:${portKey}`);
    ports.push({
      id,
      connection_id: connectionId,
      device_id: deviceId(connectionId, deviceKey),
      port_key: portKey,
      name,
      kind,
      speed_bps: speedGb * 1_000_000_000,
      admin_state: "up",
      oper_state: "up",
      media: speedGb >= 100 ? "QSFP28" : speedGb >= 40 ? "QSFP+" : "SFP+",
      description: null,
      extra: {},
    });
    return id;
  }

  for (const site of SITES) {
    const siteTag = site.slice(0, 3);
    // spines
    for (let s = 0; s < 2; s++) {
      const key = `${siteTag}-spine${s + 1}`;
      addDevice(key, `${key}`, site, "spine", MODELS[0]);
      for (let p = 0; p < 8; p++) addPort(key, `e${p + 1}`, `Ethernet${p + 1}`, "fabric", 100);
    }
    // leaves
    for (let l = 0; l < 2; l++) {
      const key = `${siteTag}-leaf${l + 1}`;
      addDevice(key, key, site, "leaf", MODELS[1]);
      for (let p = 0; p < 12; p++) {
        const kind = p < 2 ? "fabric" : p < 4 ? "tap" : p < 6 ? "span" : "access";
        addPort(key, `e${p + 1}`, `Ethernet${p + 1}`, kind, p < 4 ? 40 : 10);
      }
    }
    // broker
    const brokerKey = `${siteTag}-broker1`;
    addDevice(brokerKey, brokerKey, site, "broker", MODELS[2]);
    for (let p = 0; p < 16; p++) {
      const kind = p < 6 ? "tap" : p < 10 ? "span" : "tool";
      addPort(brokerKey, `e${p + 1}`, `Ethernet${p + 1}`, kind, kind === "tool" ? 10 : 40);
    }
    // tool devices
    for (let t = 0; t < 2; t++) {
      const key = `${siteTag}-tool${t + 1}`;
      addDevice(key, `${t === 0 ? "IDS" : "NDR"}-${key}`, site, "tool", MODELS[3]);
      for (let p = 0; p < 4; p++) addPort(key, `e${p + 1}`, `Ethernet${p + 1}`, "tool", 10);
    }

    // links: fabric spine<->leaf
    const spineKeys = [`${siteTag}-spine1`, `${siteTag}-spine2`];
    const leafKeys = [`${siteTag}-leaf1`, `${siteTag}-leaf2`];
    let fp = 0;
    for (const sp of spineKeys) {
      for (const lf of leafKeys) {
        const srcPort = portId(connectionId, `${sp}:e${(fp % 8) + 1}`);
        const dstPort = portId(connectionId, `${lf}:e1`);
        links.push({
          id: `${connectionId}:link:${sp}-${lf}-${fp}`,
          connection_id: connectionId,
          src_port_id: srcPort,
          dst_port_id: dstPort,
          link_key: `${sp}<->${lf}`,
          kind: "fabric",
          status: "up",
          extra: {},
        });
        fp++;
      }
    }
    // tap links: leaf tap ports -> broker tap ports
    let tp = 0;
    for (const lf of leafKeys) {
      const srcPort = portId(connectionId, `${lf}:e3`);
      const dstPort = portId(connectionId, `${brokerKey}:e${(tp % 6) + 1}`);
      links.push({
        id: `${connectionId}:link:tap-${lf}-${tp}`,
        connection_id: connectionId,
        src_port_id: srcPort,
        dst_port_id: dstPort,
        link_key: `${lf}(tap)<->${brokerKey}`,
        kind: "tap",
        status: "up",
        extra: {},
      });
      tp++;
    }
    // tool links: broker tool ports -> tool devices
    const toolKeys = [`${siteTag}-tool1`, `${siteTag}-tool2`];
    let tl = 0;
    for (const tool of toolKeys) {
      const srcPort = portId(connectionId, `${brokerKey}:e${11 + (tl % 6)}`);
      const dstPort = portId(connectionId, `${tool}:e1`);
      links.push({
        id: `${connectionId}:link:tool-${tool}-${tl}`,
        connection_id: connectionId,
        src_port_id: srcPort,
        dst_port_id: dstPort,
        link_key: `${brokerKey}(tool)<->${tool}`,
        kind: "tool",
        status: "up",
        extra: {},
      });
      tl++;
    }

    // Visibility policies on the broker
    policies.push({
      id: `${connectionId}:policy:${brokerKey}-p1`,
      connection_id: connectionId,
      policy_key: `${brokerKey}-p1`,
      name: `${site} east-west visibility`,
      device_key: brokerKey,
      enabled: true,
      priority: 100,
      ingress_ports: [`${brokerKey}:e1`, `${brokerKey}:e2`],
      egress_ports: [`${brokerKey}:e11`],
      actions: { filter: "tcp or udp", dedup: true, slice_bytes: 128 },
      match_rules: { any: true },
      revision: 1,
    });
    policies.push({
      id: `${connectionId}:policy:${brokerKey}-p2`,
      connection_id: connectionId,
      policy_key: `${brokerKey}-p2`,
      name: `${site} north-south to NDR`,
      device_key: brokerKey,
      enabled: true,
      priority: 90,
      ingress_ports: [`${brokerKey}:e3`, `${brokerKey}:e4`],
      egress_ports: [`${brokerKey}:e12`, `${brokerKey}:e13`],
      actions: { load_balance: "hash-5tuple", dedup: true },
      match_rules: { vlan: "any" },
      revision: 1,
    });
  }

  return { devices, ports, links, policies };
}

export function buildSimulatedAlarms(connectionId: string, topo: SimulatedTopology): MatrixAlarm[] {
  const now = new Date();
  const leaf = topo.devices.find((d) => d.role === "leaf");
  const brokerPort = topo.ports.find((p) => p.kind === "tool");
  const alarms: MatrixAlarm[] = [];
  if (leaf) {
    alarms.push({
      id: `${connectionId}:alarm:link-down`,
      connection_id: connectionId,
      alarm_key: "link-down-1",
      device_key: leaf.device_key,
      port_key: null,
      severity: "major",
      state: "active",
      category: "link",
      message: `Fabric link flap detected on ${leaf.name}`,
      raised_at: new Date(now.getTime() - 45 * 60_000).toISOString(),
      cleared_at: null,
      extra: {},
    });
  }
  if (brokerPort) {
    alarms.push({
      id: `${connectionId}:alarm:optical`,
      connection_id: connectionId,
      alarm_key: "optical-1",
      device_key: null,
      port_key: brokerPort.port_key,
      severity: "minor",
      state: "active",
      category: "optical",
      message: `Optical RX power degraded on ${brokerPort.name}`,
      raised_at: new Date(now.getTime() - 3 * 3600_000).toISOString(),
      cleared_at: null,
      extra: { rx_dbm: -18.2 },
    });
    alarms.push({
      id: `${connectionId}:alarm:discards`,
      connection_id: connectionId,
      alarm_key: "discard-threshold-1",
      device_key: null,
      port_key: brokerPort.port_key,
      severity: "warning",
      state: "active",
      category: "discards",
      message: `Discard rate exceeded threshold on ${brokerPort.name}`,
      raised_at: new Date(now.getTime() - 20 * 60_000).toISOString(),
      cleared_at: null,
      extra: { threshold_pct: 1 },
    });
  }
  return alarms;
}

export function buildSimulatedConfigRevision(
  connectionId: string,
  topo: SimulatedTopology,
  revision: number,
): MatrixConfigRevision {
  return {
    id: `${connectionId}:rev:${revision}`,
    connection_id: connectionId,
    revision,
    author: "matrix-sim",
    summary: revision === 1 ? "Initial visibility fabric provisioning" : `Policy tuning pass ${revision}`,
    snapshot: { policies: topo.policies },
    captured_at: new Date().toISOString(),
  };
}

/** One congested port and one erroring port, chosen deterministically. */
function specialPorts(connectionId: string, ports: MatrixPort[]) {
  const rand = mulberry32(seedFromString(`${connectionId}-special`));
  const eligible = ports.filter((p) => p.kind !== "fabric");
  const congested = eligible[Math.floor(rand() * eligible.length)]?.id;
  const erroring = eligible[Math.floor(rand() * eligible.length)]?.id;
  return { congested, erroring };
}

export function buildSimulatedCounters(
  connectionId: string,
  ports: MatrixPort[],
  now = new Date(),
): MatrixPortCounterSample[] {
  const rand = mulberry32(seedFromString(`${connectionId}-${now.toISOString().slice(0, 13)}`));
  const { congested, erroring } = specialPorts(connectionId, ports);
  const hour = now.getUTCHours();
  const diurnal = 0.35 + 0.5 * Math.max(0, Math.sin(((hour - 6) / 24) * Math.PI * 2));
  return ports.map((port) => {
    const speed = port.speed_bps ?? 10_000_000_000;
    let util = Math.min(0.95, diurnal * (0.3 + rand() * 0.4));
    let errors = Math.floor(rand() * 2);
    let discards = Math.floor(rand() * 3);
    if (port.id === congested) util = Math.min(0.98, 0.85 + rand() * 0.14);
    if (port.id === erroring) {
      errors = 50 + Math.floor(rand() * 200);
      discards = 20 + Math.floor(rand() * 100);
    }
    const bytesPerSec = (speed / 8) * util;
    return {
      port_id: port.id,
      bucket_ts: now.toISOString(),
      rx_bytes: Math.round(bytesPerSec * (0.4 + rand() * 0.2)),
      tx_bytes: Math.round(bytesPerSec * (0.4 + rand() * 0.2)),
      rx_packets: Math.round((bytesPerSec / 800) * (0.9 + rand() * 0.2)),
      tx_packets: Math.round((bytesPerSec / 800) * (0.9 + rand() * 0.2)),
      errors,
      discards,
      crc_errors: port.id === erroring ? Math.floor(rand() * 10) : 0,
      utilization_pct: Math.round(util * 1000) / 10,
    };
  });
}

export function buildSimulatedSnapshot(connectionId: string, revision = 1): MatrixSnapshot {
  const topo = buildSimulatedTopology(connectionId);
  return {
    devices: topo.devices,
    ports: topo.ports,
    links: topo.links,
    alarms: buildSimulatedAlarms(connectionId, topo),
    policies: topo.policies,
    configRevision: buildSimulatedConfigRevision(connectionId, topo, revision),
    counters: buildSimulatedCounters(connectionId, topo.ports),
  };
}
