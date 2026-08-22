"""Deterministic, dependency-free evidence parsers.

The parsers intentionally produce metadata and normalized observations. They do
not perform content decryption, malware execution, or application-payload
interpretation.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import csv
import io
import ipaddress
import json
import re
import struct
from typing import Any
import xml.etree.ElementTree as ET
import zipfile

from .packet_decoder import TsharkDecodeError, TsharkUnavailable, decode_capture


PARSER_VERSION = "1.0.0"
SUPPORTED_SOURCE_TYPES = {
    "pcap",
    "pcapng",
    "normalized-pcap",
    "json",
    "jsonl",
    "syslog",
    "ipfix",
    "netflow",
    "sflow",
    "cloud-flow",
    "csv",
    "xlsx",
}
SENSITIVE_KEYS = {
    "api_key",
    "authorization",
    "cookie",
    "credential",
    "decryption_key",
    "password",
    "private_key",
    "secret",
    "session_key",
    "sslkeylogfile",
    "tls_key",
    "token",
}
ALLOWED_METADATA_KEYS = {
    "acquisition_method",
    "capture_drops",
    "chain_of_custody",
    "classification",
    "clock_sync_status",
    "collector_identity",
    "direction",
    "exporter_identity",
    "interface",
    "ipfix_template_status",
    "legal_hold",
    "observation_point",
    "sampling_rate",
    "schema_version",
    "source_timezone",
    "tool_version",
}
SYSLOG_PATTERN = re.compile(
    r"^(?:<(?P<priority>\d{1,3})>)?(?P<timestamp>\S+(?:\s+\d{2}:\d{2}:\d{2})?)?\s*"
    r"(?P<host>\S+)?\s*(?P<message>.*)$"
)


class ParseError(ValueError):
    pass


@dataclass(frozen=True)
class ParsedEvidence:
    parser_name: str
    parser_version: str
    metadata: dict[str, Any]
    quality_warnings: list[str]
    observations: list[dict[str, Any]]


def parse_evidence(
    source_type: str, content: bytes, metadata: dict[str, Any], max_records: int
) -> ParsedEvidence:
    source_type = source_type.lower().strip()
    if source_type not in SUPPORTED_SOURCE_TYPES:
        raise ParseError(
            f"unsupported source_type; choose one of {', '.join(sorted(SUPPORTED_SOURCE_TYPES))}"
        )
    clean_metadata, metadata_redactions, metadata_omissions = minimize_metadata(metadata)
    warnings = metadata_quality_warnings(source_type, clean_metadata)
    if metadata_redactions:
        warnings.append(
            f"{metadata_redactions} sensitive metadata field(s) were removed from normalized context"
        )
    if metadata_omissions:
        warnings.append(
            f"{metadata_omissions} unrecognized or non-scalar metadata field(s) were not included"
        )

    if source_type in {"pcap", "pcapng"}:
        try:
            observations, parser_metadata = decode_capture(content, max_records)
            parser_name = "nettap-tshark-metadata"
        except TsharkUnavailable:
            if source_type == "pcapng" or content.startswith(b"\x0a\x0d\x0d\x0a"):
                raise ParseError(
                    "PCAPNG requires the managed TShark decoder; normalize it with TShark"
                )
            observations, parser_metadata = parse_pcap(content, max_records)
            parser_name = "nettap-pcap-metadata"
            warnings.append("TShark was unavailable; the limited built-in PCAP parser was used")
        except TsharkDecodeError as exc:
            raise ParseError(str(exc)) from exc
        clean_metadata.update(parser_metadata)
    elif source_type == "syslog":
        observations = parse_syslog(content, max_records)
        parser_name = "nettap-syslog-lines"
    elif source_type in {"csv", "xlsx"}:
        observations, redactions = parse_tabular(content, source_type, max_records)
        if redactions:
            warnings.append(
                f"{redactions} sensitive record field(s) were redacted from normalized observations"
            )
        parser_name = f"nettap-normalized-{source_type}"
    else:
        observations, redactions = parse_structured(content, source_type, max_records)
        if redactions:
            warnings.append(
                f"{redactions} sensitive record field(s) were redacted from normalized observations"
            )
        parser_name = "nettap-normalized-json"

    if not observations:
        warnings.append("The parser produced no normalized observations")
    if len(observations) >= max_records:
        warnings.append(f"Normalized records were limited to {max_records}")

    return ParsedEvidence(
        parser_name=parser_name,
        parser_version=PARSER_VERSION,
        metadata=clean_metadata,
        quality_warnings=warnings,
        observations=observations,
    )


def metadata_quality_warnings(source_type: str, metadata: dict[str, Any]) -> list[str]:
    warnings = []
    required = {
        "source_timezone": "Source timezone was not supplied",
        "clock_sync_status": "Clock-synchronization status is unknown",
        "observation_point": "Observation point was not supplied",
        "schema_version": "Source schema version was not supplied",
        "chain_of_custody": "Chain-of-custody reference was not supplied",
    }
    for key, warning in required.items():
        if metadata.get(key) in (None, "", "unknown"):
            warnings.append(warning)
    if source_type in {"ipfix", "netflow", "sflow"}:
        for key, warning in {
            "exporter_identity": "Flow exporter identity was not supplied",
            "sampling_rate": "Flow sampling configuration is unknown",
        }.items():
            if metadata.get(key) in (None, "", "unknown"):
                warnings.append(warning)
    if source_type == "ipfix" and metadata.get("ipfix_template_status") in (
        None,
        "",
        "unknown",
    ):
        warnings.append("IPFIX template status is unknown")
    if source_type in {"pcap", "pcapng", "normalized-pcap"}:
        if metadata.get("capture_drops") in (None, "", "unknown"):
            warnings.append("Capture-drop count is unknown")
        if metadata.get("truncation") in (None, "", "unknown"):
            warnings.append("Capture truncation status is unknown")
    return warnings


def parse_structured(
    content: bytes, source_type: str, max_records: int
) -> tuple[list[dict[str, Any]], int]:
    text = decode_text(content)
    records: list[Any]
    try:
        decoded = json.loads(text)
        validate_json_shape(decoded)
        if isinstance(decoded, list):
            records = decoded
        else:
            records = [decoded]
    except RecursionError as exc:
        raise ParseError("structured evidence exceeds the supported JSON nesting depth") from exc
    except json.JSONDecodeError:
        records = []
        for line_number, line in enumerate(text.splitlines(), 1):
            if not line.strip():
                continue
            try:
                decoded_line = json.loads(line)
                validate_json_shape(decoded_line)
                records.append(decoded_line)
            except RecursionError as exc:
                raise ParseError(
                    f"structured evidence on line {line_number} exceeds the supported JSON nesting depth"
                ) from exc
            except json.JSONDecodeError as exc:
                raise ParseError(f"invalid JSON on line {line_number}: {exc.msg}") from exc

    observations = []
    redactions = 0
    for record in records[:max_records]:
        if not isinstance(record, dict):
            raise ParseError("each structured evidence record must be a JSON object")
        try:
            clean, count = redact_sensitive(record)
        except RecursionError as exc:
            raise ParseError("structured evidence exceeds the supported nesting depth") from exc
        redactions += count
        observations.append(normalize_record(clean, source_type))
    return observations, redactions


def parse_syslog(content: bytes, max_records: int) -> list[dict[str, Any]]:
    observations = []
    for line in decode_text(content).splitlines()[:max_records]:
        if not line.strip():
            continue
        match = SYSLOG_PATTERN.match(line.strip())
        if not match:
            observations.append({"kind": "syslog", "message": line[:4096]})
            continue
        item: dict[str, Any] = {
            "kind": "syslog",
            "message": match.group("message")[:4096],
        }
        if match.group("priority"):
            priority = int(match.group("priority"))
            item["facility"] = priority // 8
            item["severity"] = priority % 8
        if match.group("host"):
            item["host"] = match.group("host")
        if match.group("timestamp"):
            item["source_timestamp"] = match.group("timestamp")
        observations.append(item)
    return observations


def parse_tabular(
    content: bytes, source_type: str, max_records: int
) -> tuple[list[dict[str, Any]], int]:
    if source_type == "csv":
        try:
            reader = csv.DictReader(io.StringIO(decode_text(content), newline=""))
            if not reader.fieldnames or not any(str(item).strip() for item in reader.fieldnames):
                raise ParseError("CSV evidence requires a header row")
            records = [dict(row) for _, row in zip(range(max_records), reader)]
        except csv.Error as exc:
            raise ParseError(f"invalid CSV evidence: {exc}") from exc
    else:
        records = parse_xlsx_rows(content, max_records)

    observations = []
    redactions = 0
    for record in records:
        clean, count = redact_sensitive(record)
        redactions += count
        observations.append(normalize_record(clean, source_type))
    return observations, redactions


def parse_xlsx_rows(content: bytes, max_records: int) -> list[dict[str, Any]]:
    """Read the first XLSX worksheet without formulas, macros or external links."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except (OSError, zipfile.BadZipFile) as exc:
        raise ParseError("XLSX evidence is not a valid Office Open XML workbook") from exc
    with archive:
        members = {item.filename: item for item in archive.infolist()}
        required = "xl/worksheets/sheet1.xml"
        if required not in members:
            raise ParseError("XLSX evidence requires a first worksheet")
        selected = [required]
        if "xl/sharedStrings.xml" in members:
            selected.append("xl/sharedStrings.xml")
        if sum(members[name].file_size for name in selected) > 64 * 1024 * 1024:
            raise ParseError("XLSX worksheet data exceeds the 64 MiB normalization limit")

        shared = []
        if "xl/sharedStrings.xml" in members:
            try:
                root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            except (ET.ParseError, RuntimeError, zipfile.BadZipFile) as exc:
                raise ParseError("XLSX shared strings are invalid") from exc
            shared = ["".join(node.itertext()) for node in root.findall("{*}si")]
        try:
            sheet = ET.fromstring(archive.read(required))
        except (ET.ParseError, RuntimeError, zipfile.BadZipFile) as exc:
            raise ParseError("XLSX first worksheet XML is invalid") from exc

    rows = []
    for row in sheet.findall(".//{*}sheetData/{*}row"):
        values: dict[int, str] = {}
        for cell in row.findall("{*}c"):
            reference = cell.get("r", "")
            column = xlsx_column_index(reference)
            kind = cell.get("t", "")
            value_node = cell.find("{*}v")
            if kind == "inlineStr":
                inline = cell.find("{*}is")
                value = "" if inline is None else "".join(inline.itertext())
            else:
                value = "" if value_node is None or value_node.text is None else value_node.text
                if kind == "s" and value:
                    try:
                        value = shared[int(value)]
                    except (ValueError, IndexError) as exc:
                        raise ParseError("XLSX contains an invalid shared-string reference") from exc
            values[column] = value
        if values:
            rows.append([values.get(index, "") for index in range(max(values) + 1)])
        if len(rows) >= max_records + 1:
            break
    if not rows:
        raise ParseError("XLSX first worksheet is empty")
    headers = [str(item).strip() for item in rows[0]]
    if not any(headers):
        raise ParseError("XLSX evidence requires a header row")
    if len(set(filter(None, headers))) != len(list(filter(None, headers))):
        raise ParseError("XLSX header names must be unique")
    return [
        {header: row[index] if index < len(row) else "" for index, header in enumerate(headers) if header}
        for row in rows[1:]
    ]


def xlsx_column_index(reference: str) -> int:
    letters = "".join(item for item in reference.upper() if "A" <= item <= "Z")
    if not letters or len(letters) > 3:
        raise ParseError("XLSX contains an invalid or excessively wide cell reference")
    result = 0
    for letter in letters:
        result = result * 26 + ord(letter) - ord("A") + 1
    return result - 1


def parse_pcap(content: bytes, max_records: int) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if len(content) < 24:
        raise ParseError("PCAP global header is incomplete")
    magic = content[:4]
    formats = {
        b"\xd4\xc3\xb2\xa1": ("<", 1_000_000),
        b"\xa1\xb2\xc3\xd4": (">", 1_000_000),
        b"\x4d\x3c\xb2\xa1": ("<", 1_000_000_000),
        b"\xa1\xb2\x3c\x4d": (">", 1_000_000_000),
    }
    if magic not in formats:
        if magic == b"\x0a\x0d\x0d\x0a":
            raise ParseError("PCAPNG is not supported by the built-in parser; normalize it with TShark")
        raise ParseError("unsupported capture format or byte order")
    endian, timestamp_divisor = formats[magic]
    try:
        _, major, minor, _, _, snaplen, linktype = struct.unpack(
            f"{endian}IHHIIII", content[:24]
        )
    except struct.error as exc:
        raise ParseError("invalid PCAP global header") from exc
    if major != 2:
        raise ParseError(f"unsupported PCAP major version: {major}")
    if linktype not in {1, 101}:
        raise ParseError(f"unsupported PCAP link type: {linktype}; supported: Ethernet and raw IP")

    observations = []
    position = 24
    capture_truncated_records = 0
    while position < len(content) and len(observations) < max_records:
        if len(content) - position < 16:
            raise ParseError("truncated PCAP packet header")
        seconds, fraction, included_length, original_length = struct.unpack(
            f"{endian}IIII", content[position : position + 16]
        )
        position += 16
        if included_length > len(content) - position:
            raise ParseError("truncated PCAP packet data")
        packet = content[position : position + included_length]
        position += included_length
        try:
            timestamp = datetime.fromtimestamp(
                seconds + fraction / timestamp_divisor, tz=timezone.utc
            ).isoformat().replace("+00:00", "Z")
        except (OverflowError, OSError, ValueError) as exc:
            raise ParseError("PCAP packet timestamp is outside the supported range") from exc
        observation = parse_packet(packet, linktype)
        observation.update(
            {
                "kind": "packet-metadata",
                "timestamp": timestamp,
                "captured_length": included_length,
                "original_length": original_length,
            }
        )
        if included_length < original_length:
            observation["capture_truncated"] = True
            capture_truncated_records += 1
        observations.append(observation)

    metadata = {
        "pcap_version": f"{major}.{minor}",
        "pcap_snaplen": snaplen,
        "pcap_linktype": linktype,
        "pcap_records_parsed": len(observations),
        "pcap_truncated_records": capture_truncated_records,
    }
    return observations, metadata


def parse_packet(packet: bytes, linktype: int) -> dict[str, Any]:
    offset = 0
    ether_type: int | None = None
    result: dict[str, Any] = {}
    if linktype == 1:
        if len(packet) < 14:
            return {"decode_status": "truncated-ethernet"}
        result["dst_mac"] = format_mac(packet[0:6])
        result["src_mac"] = format_mac(packet[6:12])
        ether_type = struct.unpack("!H", packet[12:14])[0]
        offset = 14
        vlan_ids = []
        while ether_type in {0x8100, 0x88A8} and len(vlan_ids) < 2:
            if len(packet) < offset + 4:
                return {**result, "decode_status": "truncated-vlan"}
            tag, ether_type = struct.unpack("!HH", packet[offset : offset + 4])
            vlan_ids.append(tag & 0x0FFF)
            offset += 4
        if vlan_ids:
            result["vlan_ids"] = vlan_ids
    elif linktype == 101:
        if not packet:
            return {"decode_status": "empty-raw-ip"}
        version = packet[0] >> 4
        ether_type = 0x0800 if version == 4 else 0x86DD if version == 6 else None

    if ether_type == 0x0800:
        result.update(parse_ipv4(packet, offset))
    elif ether_type == 0x86DD:
        result.update(parse_ipv6(packet, offset))
    elif ether_type == 0x0806:
        result.update({"protocol": "ARP", "decode_status": "metadata-only"})
    else:
        result.update(
            {
                "protocol": f"ETHERTYPE-0x{ether_type:04x}" if ether_type is not None else "unknown",
                "decode_status": "unsupported-network-layer",
            }
        )
    return result


def parse_ipv4(packet: bytes, offset: int) -> dict[str, Any]:
    if len(packet) < offset + 20:
        return {"decode_status": "truncated-ipv4", "protocol": "IPv4"}
    version_ihl = packet[offset]
    if version_ihl >> 4 != 4:
        return {"decode_status": "invalid-ipv4-version", "protocol": "IPv4"}
    header_length = (version_ihl & 0x0F) * 4
    if header_length < 20 or len(packet) < offset + header_length:
        return {"decode_status": "invalid-ipv4-header", "protocol": "IPv4"}
    protocol_number = packet[offset + 9]
    result: dict[str, Any] = {
        "src_ip": str(ipaddress.ip_address(packet[offset + 12 : offset + 16])),
        "dst_ip": str(ipaddress.ip_address(packet[offset + 16 : offset + 20])),
        "ip_version": 4,
        "ip_total_length": struct.unpack("!H", packet[offset + 2 : offset + 4])[0],
        "ttl": packet[offset + 8],
    }
    result.update(parse_transport(packet, offset + header_length, protocol_number))
    return result


def parse_ipv6(packet: bytes, offset: int) -> dict[str, Any]:
    if len(packet) < offset + 40:
        return {"decode_status": "truncated-ipv6", "protocol": "IPv6"}
    if packet[offset] >> 4 != 6:
        return {"decode_status": "invalid-ipv6-version", "protocol": "IPv6"}
    next_header = packet[offset + 6]
    result: dict[str, Any] = {
        "src_ip": str(ipaddress.ip_address(packet[offset + 8 : offset + 24])),
        "dst_ip": str(ipaddress.ip_address(packet[offset + 24 : offset + 40])),
        "ip_version": 6,
        "ip_payload_length": struct.unpack("!H", packet[offset + 4 : offset + 6])[0],
        "hop_limit": packet[offset + 7],
    }
    if next_header in {0, 43, 44, 50, 51, 60}:
        result.update(
            {
                "protocol": f"IP-{next_header}",
                "decode_status": "ipv6-extension-chain-not-expanded",
            }
        )
    else:
        result.update(parse_transport(packet, offset + 40, next_header))
    return result


def parse_transport(packet: bytes, offset: int, protocol_number: int) -> dict[str, Any]:
    names = {1: "ICMP", 6: "TCP", 17: "UDP", 47: "GRE", 50: "ESP", 58: "ICMPv6"}
    result: dict[str, Any] = {"protocol": names.get(protocol_number, f"IP-{protocol_number}")}
    if protocol_number in {6, 17}:
        if len(packet) < offset + 4:
            result["decode_status"] = "truncated-transport"
            return result
        result["src_port"], result["dst_port"] = struct.unpack("!HH", packet[offset : offset + 4])
        if protocol_number == 6 and len(packet) >= offset + 14:
            flags = packet[offset + 13]
            result["tcp_flags"] = "".join(
                name
                for bit, name in (
                    (0x02, "S"),
                    (0x10, "A"),
                    (0x01, "F"),
                    (0x04, "R"),
                    (0x08, "P"),
                    (0x20, "U"),
                )
                if flags & bit
            )
    return result


def normalize_record(record: dict[str, Any], source_type: str) -> dict[str, Any]:
    aliases = {
        "timestamp": (
            "timestamp", "time", "ts", "start_time", "flow_start", "flow_start_utc"
        ),
        "end_timestamp": ("end_time", "flow_end", "flow_end_utc"),
        "src_ip": ("src_ip", "source_ip", "srcaddr", "src"),
        "dst_ip": ("dst_ip", "destination_ip", "dstaddr", "dst"),
        "src_port": ("src_port", "source_port", "srcport"),
        "dst_port": ("dst_port", "destination_port", "dstport"),
        "protocol": ("protocol", "proto", "protocol_name"),
        "bytes": ("bytes", "octets", "byte_count"),
        "packets": ("packets", "packet_count"),
        "tcp_flags": ("tcp_flags", "flags"),
        "direction": ("direction", "traffic_direction"),
    }
    lower = {str(key).lower(): value for key, value in record.items()}
    normalized: dict[str, Any] = {
        "kind": source_type,
        "observed_fields": sorted(
            key for key, value in lower.items() if value != "[REDACTED]"
        )[:128],
    }
    for target, candidates in aliases.items():
        for candidate in candidates:
            if candidate in lower and lower[candidate] not in (None, ""):
                normalized[target] = scalar_value(lower[candidate])
                break
    if source_type in {
        "normalized-pcap", "ipfix", "netflow", "sflow", "cloud-flow", "csv", "xlsx"
    }:
        if not any(key in normalized for key in ("src_ip", "dst_ip", "protocol", "timestamp")):
            raise ParseError(
                f"{source_type} record does not contain a recognized endpoint, protocol or timestamp field"
            )
    return normalized


def validate_json_shape(value: Any, maximum_depth: int = 32) -> None:
    stack = [(value, 0)]
    while stack:
        current, depth = stack.pop()
        if depth > maximum_depth:
            raise ParseError(
                f"structured evidence exceeds the supported JSON nesting depth of {maximum_depth}"
            )
        if isinstance(current, dict):
            stack.extend((item, depth + 1) for item in current.values())
        elif isinstance(current, list):
            stack.extend((item, depth + 1) for item in current)


def redact_sensitive(value: Any) -> tuple[Any, int]:
    count = 0
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            normalized_key = str(key).lower().replace("-", "_")
            if normalized_key in SENSITIVE_KEYS:
                result[key] = "[REDACTED]"
                count += 1
            else:
                clean, nested = redact_sensitive(item)
                result[key] = clean
                count += nested
        return result, count
    if isinstance(value, list):
        result = []
        for item in value:
            clean, nested = redact_sensitive(item)
            result.append(clean)
            count += nested
        return result, count
    return scalar_value(value), 0


def minimize_metadata(metadata: dict[str, Any]) -> tuple[dict[str, Any], int, int]:
    """Return only reviewed provenance fields suitable for minimized context."""
    if not isinstance(metadata, dict):
        raise ParseError("evidence metadata must be a JSON object")
    result: dict[str, Any] = {}
    redactions = 0
    omissions = 0
    for key, value in metadata.items():
        normalized_key = str(key).lower().replace("-", "_")
        if normalized_key in SENSITIVE_KEYS:
            redactions += 1
            continue
        if normalized_key not in ALLOWED_METADATA_KEYS or isinstance(value, (dict, list)):
            omissions += 1
            continue
        result[normalized_key] = scalar_value(value)
    return result, redactions, omissions


def scalar_value(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:4096]
    return str(value)[:4096]


def decode_text(content: bytes) -> str:
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ParseError("text evidence must be valid UTF-8") from exc


def format_mac(value: bytes) -> str:
    return ":".join(f"{item:02x}" for item in value)
