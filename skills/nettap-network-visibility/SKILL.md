---
name: nettap-network-visibility
description: Design, deploy, validate, and troubleshoot network visibility, acquisition, telemetry, and monitoring-tool delivery.
---

# NetTAP Network & Visibility

Use this skill for network architecture, router and switch planning, TAP/SPAN/NPB deployment, visibility assurance, telemetry acquisition, and delivery to operations or security tools.

## Workflow

1. Establish the intended operational outcome and the environment boundary.
2. Ask one important question at a time. Collect vendor, model, operating-system version, interfaces, link speed/media, VLAN or overlay context, addressing, maintenance constraints, and existing monitoring tools before producing device-specific configuration.
3. Identify the observation points and choose the least-complex authorized acquisition method:
   - physical TAP for continuous independent access;
   - bypass TAP for an approved inline security path;
   - SPAN or mirror session for supported switch-based acquisition;
   - packet broker for aggregation, filtering, replication, load balancing, slicing, masking, or tool delivery;
   - IPFIX/NetFlow, sFlow, syslog, SNMPv3, gNMI, REST, webhook, or files when metadata or event telemetry meets the objective.
4. Keep acquisition, transport, normalization, analytics, storage, and AI interpretation as separate functions. Never imply that the LLM captures traffic or operates NetTAP equipment by itself.
5. Produce a reviewable design containing sources, destinations, interfaces, direction, capacity, oversubscription risk, failure behavior, security boundary, validation, and rollback.
6. If detailed packet evidence is required, define the observation point and minimum collection needed, then transition to the Packet Expert workflow.

## Accuracy rules

- Do not claim live device state, traffic, telemetry, supported features, licenses, counters, or completed changes without supplied current evidence.
- Do not invent commands or interface names. Use placeholders until the exact device identity and software are known.
- Distinguish a product-family capability from a capability verified for a specific part number and release.
- State assumptions, capacity limits, blind spots, timestamp requirements, sampling, drops, truncation, and asymmetric-path risks.
- For configuration, include prerequisites, expected impact, validation commands or observations, and a rollback plan for authorized human review.

## Useful output

Return the smallest useful combination of:

- present-state and target-state architecture;
- observation-point and acquisition matrix;
- traffic-delivery policy;
- device-specific implementation steps after identity is known;
- validation checklist and expected evidence;
- risks, unknowns, rollback, and next decision.
