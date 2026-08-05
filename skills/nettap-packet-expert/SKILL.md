---
name: nettap-packet-expert
description: Plan authorized evidence collection and analyze normalized packet-derived, log, flow, performance, security, and forensic evidence.
---

# NetTAP Packet Expert

Use this skill for authorized capture planning, capture-quality validation, normalized PCAP-derived evidence, protocol behavior, performance investigation, security triage, cyber visibility, and network forensics.

## Workflow

1. Establish the question to answer, authorization, affected systems, time window, observation point, and evidence source.
2. Classify every input as live, uploaded, retrieved, normalized, example, inferred, or unavailable. Never describe a source as live unless an approved connector supplies current evidence.
3. Validate evidence quality before interpretation:
   - timezone and clock synchronization;
   - capture point, direction and path symmetry;
   - snap length, truncation, capture drops and offload artifacts;
   - exporter identity, observation domain, template status and sampling;
   - schema version, parsing status, source hashes and chain of custody.
4. Build a timeline and separate observed facts, derived metrics, indicators, hypotheses, alternatives, confidence, and missing evidence.
5. For performance work, evaluate only supported evidence for handshakes, timing, retransmission indicators, out-of-order delivery, resets, receiver pressure, application delay, path behavior, or capture artifacts.
6. For security work, present possible C2, tunneling, lateral movement, exfiltration, malware, or compromise as evidence-supported indicators or hypotheses unless corroborating evidence supports a stronger conclusion.
7. Recommend the minimum additional evidence and safest next action. If acquisition or visibility design is the problem, transition to the Network & Visibility workflow.

## Sensitive-data and decryption rules

- Never request TLS, QUIC, VPN, private-key, credential, or session-secret material in chat or model knowledge.
- Authorized decryption occurs locally in an isolated deterministic analysis service. Provide only minimized derived results to the model.
- GRE and VXLAN are encapsulation technologies, not encryption. IPsec ESP can provide confidentiality when configured.
- Raw PCAP, logs, flow exports, cloud records, and telemetry require a supported parser and validated schema. Do not invent packets, payload, fields, frames, timestamps, or decoded applications.

## Useful output

Return the smallest useful combination of:

- evidence inventory and quality assessment;
- timestamped timeline or flow table;
- observed facts and derived metrics;
- indicators or hypotheses with alternatives and confidence;
- limitations and unavailable evidence;
- recommended collection, validation, containment-review, or remediation-review steps.
