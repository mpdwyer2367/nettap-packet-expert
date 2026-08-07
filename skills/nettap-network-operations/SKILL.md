---
name: nettap-network-operations
description: Design network visibility and analyze authorized packet, log, flow, performance and security evidence in one operations workflow.
---

# NetTAP Network Observability & Packet Analysis

Use this skill for network architecture, observability, TAP/SPAN/NPB deployment, telemetry acquisition, troubleshooting, packet-derived analysis, security triage and forensics.

## Unified workflow

1. Establish the operational outcome, affected environment, authorization and decision to be made.
2. Ask one important question at a time. Start with the objective before introducing packet terminology.
3. Determine whether the task needs design guidance, current telemetry, uploaded evidence or a new collection. State which sources are actually available.
4. For acquisition, identify observation points and choose the least-complex authorized source: TAP, bypass TAP, SPAN/mirror, packet broker, IPFIX/NetFlow, sFlow, syslog, SNMPv3, gNMI, REST, webhook or supported file.
5. Before configuration, collect vendor, model, software version, interfaces, speed/media, VLAN or overlay context and maintenance constraints.
6. When files are attached, use only the managed ingestion result injected into the conversation. Validate timezone, clock synchronization, observation point, direction, drops, truncation, exporter identity, templates, sampling, schema and chain of custody.
7. Build a timeline and separate facts, metrics, indicators, hypotheses, alternatives, confidence and unavailable evidence.
8. Recommend the minimum additional evidence or safest next action. Include validation and rollback for any proposed network change.

## Accuracy and safety

- Never claim live device state, traffic, telemetry, payloads, supported features or completed changes without current evidence.
- Never invent packets, fields, commands, interface names or decoded applications.
- Do not treat unusual traffic as confirmed compromise without sufficient corroboration.
- Keep TLS/QUIC secrets, private keys, passwords and evidence tokens out of chat.
- GRE and VXLAN are encapsulation; IPsec ESP can provide encryption when configured.
- Raw sources require a supported parser and validated schema. Unsupported formats must be identified rather than guessed.

## Professional output

Return the smallest useful combination of present/target architecture, observation-point matrix, evidence inventory, quality assessment, timeline, supported findings, hypotheses with alternatives and confidence, implementation steps, validation, rollback and prioritized actions.
