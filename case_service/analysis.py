"""Evidence-bound deterministic analysis for a NetTAP case."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
import math
import statistics
from typing import Any


ENGINE_VERSION = "1.0.0"


def analyze_case(
    case: dict[str, Any],
    evidence: list[dict[str, Any]],
    observations: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    protocols: Counter[str] = Counter()
    source_ips: Counter[str] = Counter()
    destination_ips: Counter[str] = Counter()
    destination_ports: Counter[str] = Counter()
    conversations: Counter[str] = Counter()
    bytes_by_conversation: Counter[str] = Counter()
    evidence_ids = sorted({item["id"] for item in evidence})
    timestamps: list[datetime] = []
    reset_evidence: set[str] = set()
    truncated_evidence: set[str] = set()
    timing_groups: dict[str, list[tuple[datetime, str]]] = defaultdict(list)

    for item in observations:
        protocol = str(item.get("protocol", item.get("kind", "unknown"))).upper()
        protocols[protocol] += 1
        src = string_or_unknown(item.get("src_ip"))
        dst = string_or_unknown(item.get("dst_ip"))
        destination = string_or_unknown(item.get("dst_port"))
        if src != "unknown":
            source_ips[src] += 1
        if dst != "unknown":
            destination_ips[dst] += 1
        if destination != "unknown":
            destination_ports[destination] += 1
        if src != "unknown" or dst != "unknown":
            key = f"{src} -> {dst}:{destination}/{protocol}"
            conversations[key] += 1
            byte_count = integer_value(item.get("bytes"), item.get("original_length"))
            bytes_by_conversation[key] += byte_count
        timestamp = parse_timestamp(item.get("timestamp"))
        if timestamp:
            timestamps.append(timestamp)
            if src != "unknown" and dst != "unknown":
                timing_groups[f"{src}|{dst}|{destination}|{protocol}"].append(
                    (timestamp, item["evidence_id"])
                )
        if "R" in str(item.get("tcp_flags", "")):
            reset_evidence.add(item["evidence_id"])
        if item.get("capture_truncated") is True:
            truncated_evidence.add(item["evidence_id"])

    quality_warnings = []
    for item in evidence:
        quality_warnings.extend(
            {"evidence_id": item["id"], "warning": warning}
            for warning in item["quality_warnings"]
        )

    findings = []
    if quality_warnings:
        findings.append(
            finding(
                "evidence-quality",
                "Evidence-quality limitations are present",
                f"The imported sources contain {len(quality_warnings)} recorded quality limitation(s). "
                "Conclusions should be bounded by these gaps.",
                "observation",
                "high",
                sorted({item["evidence_id"] for item in quality_warnings}),
                ["Review the source-specific quality warnings before relying on negative findings."],
            )
        )
    if reset_evidence:
        reset_count = sum(1 for item in observations if "R" in str(item.get("tcp_flags", "")))
        findings.append(
            finding(
                "transport",
                "TCP reset packets were observed",
                f"The normalized evidence contains {reset_count} packet(s) with the TCP RST flag. "
                "A reset alone does not identify its cause.",
                "observation",
                "high",
                sorted(reset_evidence),
                [
                    "Correlate resets with both endpoints and application logs.",
                    "Check whether the reset direction and sequence are consistent with policy or failure.",
                ],
            )
        )
    if truncated_evidence:
        findings.append(
            finding(
                "evidence-quality",
                "Capture truncation was observed",
                "One or more packet records have captured lengths smaller than their original lengths. "
                "Application-layer conclusions may therefore be incomplete.",
                "observation",
                "high",
                sorted(truncated_evidence),
                ["Repeat the capture with an adequate snapshot length if payload metadata is required."],
            )
        )

    findings.extend(regular_timing_findings(timing_groups))
    dominant = conversations.most_common(1)
    if dominant and len(observations) >= 10 and dominant[0][1] / len(observations) >= 0.7:
        key, count = dominant[0]
        matching_evidence = sorted(
            {
                item["evidence_id"]
                for item in observations
                if conversation_key(item) == key
            }
        )
        findings.append(
            finding(
                "traffic-distribution",
                "One conversation dominates the available evidence",
                f"{key} represents {count} of {len(observations)} normalized records. "
                "This may reflect the observation point or collection filter rather than the network as a whole.",
                "observation",
                "high",
                matching_evidence,
                ["Confirm the TAP, SPAN, NPB filter and collection scope represented by this source."],
            )
        )

    summary = {
        "case_id": case["id"],
        "data_state": "uploaded",
        "live_telemetry_connected": False,
        "evidence_count": len(evidence),
        "observation_count": len(observations),
        "time_range": {
            "first": iso_timestamp(min(timestamps)) if timestamps else None,
            "last": iso_timestamp(max(timestamps)) if timestamps else None,
        },
        "protocols": top_counter(protocols),
        "top_sources": top_counter(source_ips),
        "top_destinations": top_counter(destination_ips),
        "top_destination_ports": top_counter(destination_ports),
        "top_conversations": [
            {"conversation": key, "records": count, "bytes": bytes_by_conversation[key]}
            for key, count in conversations.most_common(10)
        ],
        "quality_warnings": quality_warnings,
        "method": (
            "Deterministic parsing and aggregation only. No LLM inference, threat-intelligence lookup, "
            "payload decryption or confirmation of compromise was performed."
        ),
        "evidence_ids": evidence_ids,
    }
    return summary, findings


def regular_timing_findings(
    groups: dict[str, list[tuple[datetime, str]]]
) -> list[dict[str, Any]]:
    results = []
    for key, entries in groups.items():
        if len(entries) < 6:
            continue
        entries.sort(key=lambda item: item[0])
        intervals = [
            (entries[index][0] - entries[index - 1][0]).total_seconds()
            for index in range(1, len(entries))
        ]
        positive = [value for value in intervals if value > 0]
        if len(positive) < 5:
            continue
        mean = statistics.fmean(positive)
        if mean < 1 or mean > 86_400:
            continue
        deviation = statistics.pstdev(positive)
        coefficient = deviation / mean if mean else math.inf
        if coefficient <= 0.15:
            src, dst, port, protocol = key.split("|", 3)
            results.append(
                finding(
                    "timing-pattern",
                    "Regular connection timing warrants correlation",
                    f"{src} to {dst}:{port}/{protocol} has {len(entries)} observations with an "
                    f"average interval of {mean:.2f} seconds and interval variation of {coefficient:.3f}. "
                    "Regular timing can be benign; this is an investigation hypothesis, not confirmed C2.",
                    "hypothesis",
                    "medium",
                    sorted({item[1] for item in entries}),
                    [
                        "Correlate the endpoints with authorized asset, DNS, application and identity records.",
                        "Compare against a longer baseline and the collection sampling policy.",
                    ],
                )
            )
    return results[:10]


def finding(
    category: str,
    title: str,
    statement: str,
    classification: str,
    confidence: str,
    evidence_ids: list[str],
    validation_steps: list[str],
) -> dict[str, Any]:
    return {
        "category": category,
        "title": title,
        "statement": statement,
        "classification": classification,
        "confidence": confidence,
        "evidence_ids": evidence_ids,
        "validation_steps": validation_steps,
    }


def top_counter(counter: Counter[str], limit: int = 10) -> list[dict[str, Any]]:
    return [{"value": value, "records": count} for value, count in counter.most_common(limit)]


def parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    candidate = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed


def iso_timestamp(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def integer_value(*values: Any) -> int:
    for value in values:
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            continue
    return 0


def string_or_unknown(value: Any) -> str:
    return str(value) if value not in (None, "") else "unknown"


def conversation_key(item: dict[str, Any]) -> str:
    src = string_or_unknown(item.get("src_ip"))
    dst = string_or_unknown(item.get("dst_ip"))
    port = string_or_unknown(item.get("dst_port"))
    protocol = str(item.get("protocol", item.get("kind", "unknown"))).upper()
    return f"{src} -> {dst}:{port}/{protocol}"
