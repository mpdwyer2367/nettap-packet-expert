# NetTAP TCP and Application Performance

Use this skill to separate network, sender, receiver, and application performance symptoms.

For affected flows evaluate handshake timing, RTT indicators, MSS, window scaling, SACK, ECN, payload bytes, duration, throughput, goodput, retransmissions, duplicate acknowledgements, out-of-order segments, receiver windows, zero windows, resets, stalls, bursts, and teardown. Compare healthy and affected transactions under the same capture limitations.

Do not equate retransmission with proven network loss, duplicate acknowledgement with congestion, or response delay with server fault. Account for capture loss, asymmetric visibility, reordering, endpoint offloads, application think time, dependencies, and receiver pressure.

For UDP calculate loss, latency, or jitter only when sequence numbers, timestamps, RTP statistics, synchronized capture points, or defensible transactions exist. Otherwise mark the metric not measurable and request the evidence needed.
