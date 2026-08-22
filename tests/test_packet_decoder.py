import unittest

from case_service.packet_decoder import FIELDS, TOP_PROTOCOLS, parse_rows
from functions.nettap_evidence_ingestion import Filter


class PacketDecoderTests(unittest.TestCase):
    def test_protocol_allowlist_contains_exactly_fifty_reviewed_protocols(self):
        self.assertEqual(len(TOP_PROTOCOLS), 50)
        self.assertTrue({"tcp", "udp", "dns", "tls", "bgp", "ospf", "vxlan"} <= TOP_PROTOCOLS)

    def test_tshark_rows_are_reduced_to_metadata_without_payload(self):
        values = {field: "" for field in FIELDS}
        values.update(
            {
                "frame.number": "7",
                "frame.time_epoch": "1787342400.125",
                "frame.cap_len": "74",
                "frame.len": "74",
                "frame.protocols": "eth:ethertype:ip:tcp:tls",
                "eth.src": "00:11:22:33:44:55",
                "eth.dst": "66:77:88:99:aa:bb",
                "ip.src": "192.0.2.10",
                "ip.dst": "198.51.100.20",
                "tcp.srcport": "49152",
                "tcp.dstport": "443",
                "tcp.flags": "0x0002",
                "tcp.stream": "3",
            }
        )
        output = "\t".join(values[field] for field in FIELDS) + "\n"
        observations, counts = parse_rows(output)
        packet = observations[0]
        self.assertEqual(packet["src_ip"], "192.0.2.10")
        self.assertEqual(packet["dst_port"], 443)
        self.assertEqual(packet["protocols"], ["eth", "ip", "tcp", "tls"])
        self.assertNotIn("payload", packet)
        self.assertEqual(counts["tls"], 1)

    def test_pcapng_is_routed_to_managed_decoder(self):
        self.assertEqual(Filter._source_type("authorized-capture.pcapng"), "pcapng")


if __name__ == "__main__":
    unittest.main()
