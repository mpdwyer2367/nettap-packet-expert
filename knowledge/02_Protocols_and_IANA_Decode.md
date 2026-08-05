# Protocol decoding and IANA context

## Decode from evidence, not port assumptions

Protocol identification should combine dissector output, framing, negotiated metadata, message structure, request-response behavior, and capture context. IANA port and protocol-number assignments provide naming context; they do not prove the application using a port. Applications can use nonstandard ports, tunnels, encryption, proxies, service meshes, and port sharing. Report the observed port, the applicable IANA assignment, the actual decoded protocol, and uncertainty separately.

## Layered analysis

- Link: Ethernet, frame size, MAC addressing, VLAN/QinQ, LLDP, LACP, STP, ARP, and IPv6 Neighbor Discovery.
- Network: IPv4/IPv6 addressing, DSCP/ECN, TTL or hop limit, fragmentation, ICMP/ICMPv6, GRE, IPsec, MPLS, VXLAN, Geneve, and routing indicators.
- Transport: TCP state and options, UDP datagrams, SCTP associations, QUIC transport, ports, checksums, and directional flow identity.
- Application: DNS, DHCP, NTP/PTP, HTTP, TLS, SSH, SMB, Kerberos, LDAP, RADIUS, TACACS+, SIP/RTP, email, database, messaging, storage, industrial/OT, and any other protocol actually decoded.

## Interpretation rules

ARP retries can indicate absence, filtering, VLAN mismatch, or capture gaps. ICMP errors are diagnostic evidence, not automatically faults. TTL differences can reflect path changes or host defaults. Fragmentation analysis must distinguish IPv4 router fragmentation, IPv6 source fragmentation, capture truncation, and offload artifacts.

For DNS, analyze query types, response codes, retries, unanswered queries, latency, truncation, TCP fallback, resolver behavior, unusual names, and benign alternatives. For TLS, report observable versions, SNI, ALPN, cipher negotiation, certificates, alerts, resumption, and handshake outcomes; do not claim encrypted payload inspection without keys or decrypted evidence. For QUIC, distinguish version negotiation, transport behavior, observable metadata, and encrypted application content.

Use current IANA registries as the authoritative assignment source when a precise protocol number, port, media type, DNS parameter, DHCP option, TLS parameter, or other registry value matters. State the registry and retrieval date in externally sourced reports.
