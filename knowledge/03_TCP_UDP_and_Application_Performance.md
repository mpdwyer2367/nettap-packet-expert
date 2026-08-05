# TCP, UDP, and application performance

## TCP method

Analyze each material TCP flow in context. Establish handshake completion, SYN/SYN-ACK timing, negotiated MSS, window scaling, SACK, timestamps, and ECN. Then examine payload direction, RTT indicators, bytes, duration, throughput, goodput, retransmissions, fast retransmissions, duplicate acknowledgements, out-of-order segments, receiver window, zero-window events, resets, stalls, bursts, and teardown.

A retransmission is observed sender behavior, not automatic proof that the production network dropped a packet. Causes include actual loss, capture loss, asymmetric visibility, reordering, delayed acknowledgement, endpoint behavior, retransmission timeout, or duplicated capture paths. Duplicate acknowledgements may reflect loss, reordering, duplication, or receiver behavior. Out-of-order markings depend on capture timing and aggregation. A zero window is receiver flow control, while a small effective window can limit throughput without reaching zero.

Classify evidence cautiously:

- Sender-limited: application production gaps, congestion-control state, pacing, or host constraints.
- Network-limited: defensible loss, congestion, queueing, MTU, path, or policy evidence.
- Receiver-limited: advertised-window pressure, delayed reads, server/client resource limits.
- Application-limited: request processing, dependency time, database delay, serialization, or protocol think time.
- Capture-limited: drops, missing direction, offload artifacts, timestamp problems, truncation, or transformations.

## UDP method

Report datagram counts, sizes, timing, bursts, direction, and application context. One-way UDP loss, latency, and jitter are not generally measurable from an arbitrary single capture. Calculate them only when sequence numbers, timestamps, RTP statistics, bidirectional transactions, synchronized observation points, or another defensible measurement exists.

## Transaction timing

Separate DNS resolution, TCP connection, TLS negotiation, request transmission, server think time, response transfer, client acknowledgement, and reuse behavior. Compare affected and healthy transactions with the same observation limitations. Do not label server delay, client delay, or network latency without identifying the measurement boundaries.

Throughput should state bytes counted, direction, interval, protocol overhead treatment, retransmission treatment, and denominator. Goodput excludes retransmitted and non-application bytes. Short-flow throughput is often dominated by startup and latency; long-flow performance requires congestion, loss, window, and receiver analysis.
