"""Bounded, metadata-only packet decoding through TShark."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
from typing import Any


DECODER_VERSION = "1.0.0"
MAX_DECODE_PACKETS = 50_000
TOP_PROTOCOLS = {
    "eth", "vlan", "arp", "ip", "ipv6", "icmp", "icmpv6", "tcp", "udp", "sctp",
    "gre", "vxlan", "geneve", "mpls", "pppoe", "lacp", "lldp", "stp", "dhcp",
    "dhcpv6", "dns", "mdns", "ntp", "snmp", "http", "http2", "http3", "quic",
    "tls", "ssh", "ftp", "smtp", "imap", "pop", "ldap", "kerberos", "smb", "smb2",
    "nfs", "rpc", "sip", "sdp", "rtp", "rtcp", "bgp", "ospf", "isis", "pim",
    "vrrp", "radius",
}
PROTOCOL_ALIASES = {"bootp": "dhcp", "ssl": "tls", "pop3": "pop", "icmpv6": "icmpv6"}
FIELDS = (
    "frame.number", "frame.time_epoch", "frame.cap_len", "frame.len", "frame.protocols",
    "eth.src", "eth.dst", "vlan.id", "ip.src", "ip.dst", "ipv6.src", "ipv6.dst",
    "tcp.srcport", "tcp.dstport", "tcp.flags", "tcp.stream", "udp.srcport",
    "udp.dstport", "sctp.srcport", "sctp.dstport", "icmp.type", "icmp.code",
    "icmpv6.type", "icmpv6.code",
)


class TsharkUnavailable(RuntimeError):
    pass


class TsharkDecodeError(ValueError):
    pass


def decode_capture(content: bytes, max_records: int) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    executable = shutil.which("tshark")
    if not executable:
        raise TsharkUnavailable("TShark is not installed in the evidence service")
    try:
        configured_limit = int(os.environ.get("NETTAP_TSHARK_MAX_PACKETS", MAX_DECODE_PACKETS))
    except ValueError as exc:
        raise TsharkDecodeError("NETTAP_TSHARK_MAX_PACKETS must be an integer") from exc
    limit = max(1, min(max_records, configured_limit, MAX_DECODE_PACKETS))
    suffix = ".pcapng" if content.startswith(b"\x0a\x0d\x0d\x0a") else ".pcap"
    with tempfile.NamedTemporaryFile(prefix="nettap-decode-", suffix=suffix, dir="/tmp") as source:
        source.write(content)
        source.flush()
        command = [
            executable, "-n", "-r", source.name, "-c", str(limit), "-T", "fields",
            "-E", "separator=\t", "-E", "quote=n", "-E", "occurrence=f",
        ]
        for field in FIELDS:
            command.extend(("-e", field))
        environment = {
            "HOME": "/tmp",
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "TZ": "UTC",
        }
        try:
            result = subprocess.run(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=120,
                check=False,
                env=environment,
            )
        except subprocess.TimeoutExpired as exc:
            raise TsharkDecodeError("TShark decoding exceeded the 120-second limit") from exc
    if result.returncode != 0:
        detail = " ".join(result.stderr.strip().split())[:500]
        raise TsharkDecodeError(f"TShark could not decode the capture: {detail or 'unknown error'}")
    observations, counts = parse_rows(result.stdout)
    return observations, {
        "decoder": "tshark",
        "decoder_version": tshark_version(executable),
        "decoder_contract": f"nettap-tshark-metadata/{DECODER_VERSION}",
        "decoded_packet_count": len(observations),
        "decode_packet_limit": limit,
        "decode_limited": len(observations) >= limit,
        "recognized_protocol_counts": dict(counts.most_common()),
        "payload_fields_included": False,
        "name_resolution_enabled": False,
    }


def parse_rows(output: str) -> tuple[list[dict[str, Any]], Counter]:
    observations = []
    protocol_counts: Counter[str] = Counter()
    for line in output.splitlines():
        values = line.split("\t")
        values.extend([""] * (len(FIELDS) - len(values)))
        row = dict(zip(FIELDS, values))
        protocols = []
        for item in row["frame.protocols"].lower().split(":"):
            canonical = PROTOCOL_ALIASES.get(item, item)
            if canonical in TOP_PROTOCOLS and canonical not in protocols:
                protocols.append(canonical)
                protocol_counts[canonical] += 1
        observation: dict[str, Any] = {
            "kind": "packet-metadata",
            "frame_number": integer(row["frame.number"]),
            "captured_length": integer(row["frame.cap_len"]),
            "original_length": integer(row["frame.len"]),
            "protocols": protocols,
            "decode_status": "tshark-metadata-only",
        }
        timestamp = epoch_timestamp(row["frame.time_epoch"])
        if timestamp:
            observation["timestamp"] = timestamp
        copy_first(observation, "src_mac", row["eth.src"])
        copy_first(observation, "dst_mac", row["eth.dst"])
        copy_first(observation, "vlan_id", row["vlan.id"], integer)
        copy_first(observation, "src_ip", row["ip.src"] or row["ipv6.src"])
        copy_first(observation, "dst_ip", row["ip.dst"] or row["ipv6.dst"])
        transport = "tcp" if row["tcp.srcport"] else "udp" if row["udp.srcport"] else "sctp" if row["sctp.srcport"] else ""
        if transport:
            observation["protocol"] = transport.upper()
            copy_first(observation, "src_port", row[f"{transport}.srcport"], integer)
            copy_first(observation, "dst_port", row[f"{transport}.dstport"], integer)
        elif protocols:
            observation["protocol"] = protocols[-1].upper()
        if row["tcp.flags"]:
            observation["tcp_flags_hex"] = row["tcp.flags"].split(",", 1)[0]
        copy_first(observation, "tcp_stream", row["tcp.stream"], integer)
        observations.append({key: value for key, value in observation.items() if value is not None})
    return observations, protocol_counts


def copy_first(target: dict, key: str, value: str, converter=lambda item: item) -> None:
    first = value.split(",", 1)[0].strip() if value else ""
    if first:
        target[key] = converter(first)


def integer(value: str) -> int | None:
    try:
        return int(value, 0)
    except (TypeError, ValueError):
        return None


def epoch_timestamp(value: str) -> str | None:
    try:
        return datetime.fromtimestamp(float(value), timezone.utc).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OverflowError, OSError):
        return None


@lru_cache(maxsize=1)
def tshark_version(executable: str) -> str:
    try:
        result = subprocess.run(
            [executable, "--version"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, timeout=10, check=False, env={"HOME": "/tmp", "PATH": os.environ.get("PATH", "/usr/bin:/bin")},
        )
    except (OSError, subprocess.TimeoutExpired):
        return "unknown"
    first = result.stdout.splitlines()[0] if result.stdout else "unknown"
    return first[:160]
