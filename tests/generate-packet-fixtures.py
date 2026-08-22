#!/usr/bin/env python3
"""Create tiny deterministic Ethernet/IPv4/UDP PCAP and PCAPNG fixtures."""

from __future__ import annotations

import argparse
import struct
from pathlib import Path


def checksum(data: bytes) -> int:
    if len(data) % 2:
        data += b"\x00"
    total = sum(struct.unpack(f"!{len(data) // 2}H", data))
    while total >> 16:
        total = (total & 0xFFFF) + (total >> 16)
    return (~total) & 0xFFFF


def packet() -> bytes:
    ethernet = bytes.fromhex("00112233445566778899aabb0800")
    payload = b"NTAP"
    udp = struct.pack("!HHHH", 53000, 53, 8 + len(payload), 0) + payload
    header = struct.pack(
        "!BBHHHBBH4s4s",
        0x45,
        0,
        20 + len(udp),
        1,
        0,
        64,
        17,
        0,
        bytes([192, 0, 2, 10]),
        bytes([198, 51, 100, 53]),
    )
    header = header[:10] + struct.pack("!H", checksum(header)) + header[12:]
    return ethernet + header + udp


def pcap(frame: bytes) -> bytes:
    global_header = struct.pack("<IHHIIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 1)
    record = struct.pack("<IIII", 1_700_000_000, 123456, len(frame), len(frame))
    return global_header + record + frame


def block(block_type: int, body: bytes) -> bytes:
    padding = b"\x00" * ((4 - len(body) % 4) % 4)
    total = 12 + len(body) + len(padding)
    return struct.pack("<II", block_type, total) + body + padding + struct.pack("<I", total)


def pcapng(frame: bytes) -> bytes:
    section = block(0x0A0D0D0A, struct.pack("<IHHq", 0x1A2B3C4D, 1, 0, -1))
    interface = block(1, struct.pack("<HHI", 1, 0, 65535))
    enhanced = block(
        6,
        struct.pack("<IIIII", 0, 0, 1_700_000_000, len(frame), len(frame)) + frame,
    )
    return section + interface + enhanced


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output_directory", type=Path)
    args = parser.parse_args()
    args.output_directory.mkdir(parents=True, exist_ok=True)
    frame = packet()
    (args.output_directory / "synthetic.pcap").write_bytes(pcap(frame))
    (args.output_directory / "synthetic.pcapng").write_bytes(pcapng(frame))


if __name__ == "__main__":
    main()
