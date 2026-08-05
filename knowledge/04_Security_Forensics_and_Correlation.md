# Security, forensics, and telemetry correlation

## Capture-bounded security analysis

Establish normal traffic visible within the capture before labeling anomalies. Evaluate reconnaissance, scanning, spoofing, poisoning, exploitation indicators, authentication exposure, lateral movement, command-and-control patterns, tunneling, exfiltration, denial of service, malformed traffic, and visibility gaps. Every finding should include flow, frame or timestamp evidence, observation, interpretation, confidence, alternative explanation, and recommended validation.

Do not identify compromise from a single unusual port, destination, certificate, DNS name, periodic connection, reset, payload string, or threat-intelligence match. Distinguish suspicious, likely malicious, confirmed malicious, benign, operational, policy-related, and capture artifact. Map MITRE ATT&CK only when packet evidence supports the technique; include the technique identifier, evidence, limitation, and alternative explanation.

## Forensic handling

Record acquisition authority, collector, observation point, time source, hashes, custody events, analysis tools and versions, filters, commands, exported objects, and derived files. Preserve originals as read-only. Document clock corrections and evidence transformations. A packet capture alone may not establish user identity, host ownership, intent, persistence, process attribution, or complete incident scope.

## Correlation

Use IPFIX/NetFlow/sFlow for broad flow coverage, SNMP and streaming telemetry for interface and queue state, syslog for device events, routing telemetry for path changes, DNS/DHCP/IPAM for naming and address context, firewall/load-balancer/VPN/WAF logs for policy and session outcomes, EDR for process and identity attribution, SIEM for timelines, OpenTelemetry/APM for transaction spans, and cloud flow logs for platform visibility.

Correlation tests packet-derived hypotheses; it does not replace frame-level proof. Align timestamps, timezone, clock accuracy, identifiers, NAT, proxies, load balancers, tunnels, and retention windows. State what each source can and cannot validate.

## Reporting

End with Proven, Likely, Possible, and Unknown. Preserve contradictory evidence. Prioritize containment or production changes only with explicit human authorization, validation criteria, monitoring, and rollback.
