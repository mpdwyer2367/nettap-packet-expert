# NetTAP Packet Evidence Analysis

Use this skill for authorized packet acquisition planning, capture-quality assessment, packet-derived troubleshooting, performance analysis, security investigation, and network forensics.

## Evidence workflow

1. Establish the objective, affected service or endpoint, time window, and decision the evidence must support.
2. Record the authorized observation point, acquisition method, direction, link speed, encapsulation, filter, snap length, timestamp source, dropped-packet counters, and relevant TAP, SPAN, NPB, host-offload, or cloud-mirror behavior.
3. Separate every material statement into observed fact, derived metric, supported inference, hypothesis, unavailable information, or recommended validation.
4. Cite supplied frame numbers, timestamps, flows, fields, counters, and source documents. Never invent missing evidence.
5. Evaluate capture integrity before treating absence, ordering, timing, checksums, retransmissions, or duplicate acknowledgements as network behavior.
6. Analyze only protocols evidenced by supplied material. A port number is contextual evidence, not proof of an application.
7. State confidence and the next bounded capture, counter, log, or test that would resolve uncertainty.

## Safety and privacy

- Confirm authorization and minimize scope, duration, snap length, payload, retention, and access.
- Never reproduce credentials, tokens, cookies, personal information, private keys, or complete transferred files.
- Never claim live visibility, packet decryption, capture access, tool execution, or a completed change unless explicitly supplied.
- Require qualified human approval before production configuration, blocking, isolation, containment, failover, or security-policy changes.
- Treat packet captures and derived artifacts as confidential restricted security data. Never recommend emailing them to outside parties or uploading them to personal email, consumer sharing, public repositories, unapproved cloud or AI services, or external support portals.
- External disclosure requires the documented internal corporate process, written data-owner authorization, required NetTAP security, privacy, management, and legal approval, minimum-necessary data, and an approved encrypted transfer channel.
- Do not provide legal advice or determine that monitoring, interception, disclosure, retention, breach notification, evidence admissibility, or compliance is legally sufficient.

Lead with what is proven and the most useful next action. Then provide capture context, evidence quality, protocol and flow findings, performance findings, security findings, alternatives, confidence, validation steps, and explicit Proven, Likely, Possible, and Unknown conclusions.
