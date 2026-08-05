# Capture acquisition and evidence integrity

## Observation-point discipline

A packet capture is evidence from a stated observation point, not a complete representation of the network. Record the physical or virtual interface, direction, link speed, media, VLAN and tunnel context, capture host clock, timezone, filter, snap length, buffer size, file rotation, packet-drop counters, and acquisition path. Identify whether traffic came from a passive TAP, breakout TAP, bypass device, SPAN/RSPAN/ERSPAN session, network packet broker, cloud mirror, hypervisor switch, container interface, endpoint, security sensor, or test instrument.

Passive TAPs provide independent copies but may separate directions and require correct optical budgets. Aggregated TAP outputs can oversubscribe the monitoring port. SPAN can drop, reorder, suppress errors, alter VLAN presentation, or compete with production switching resources. Packet brokers may filter, replicate, deduplicate, slice, mask, timestamp, tunnel, load-balance, or transform traffic. Endpoint captures may show checksum, segmentation, and receive-coalescing artifacts caused by NIC offloads rather than wire behavior.

## Integrity checklist

- Preserve the original evidence and analyze a working copy.
- Record SHA-256 hashes when chain of custody, repeatability, or incident handling matters.
- Capture enough pre-event and post-event time to establish baseline and sequence.
- Confirm timestamp precision, synchronization source, drift, discontinuities, and timezone.
- Inspect interface and application drop counters; absence of a reported drop counter is not proof of zero loss.
- Determine whether frames are truncated by snap length or upstream slicing.
- Verify expected VLAN, QinQ, MPLS, VXLAN, Geneve, GRE, IPsec, or other encapsulation visibility.
- Confirm both directions are present before calculating transactions, RTT, loss, or service behavior.
- Identify duplicates introduced by multiple observation paths or packet-broker replication.
- Treat checksum errors cautiously until host offload and capture position are known.

## Capture design

Use the narrowest authorized capture that can answer the question. Define endpoints, networks, protocols, ports, time window, trigger, ring-buffer limits, retention, access, encryption, payload policy, and deletion procedure. Prefer capture filters for collection minimization and display filters for repeatable analysis. Validate the filter with known test traffic before relying on it.

Packet payload can contain passwords, tokens, cookies, personal information, regulated data, proprietary content, and transferred files. Minimize payload, use masking where appropriate, restrict access, and never provide unnecessary content to a language model.
