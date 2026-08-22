#!/usr/bin/env python3
"""Fail closed on the evaluation OVA hardware profile and manifest."""

from __future__ import annotations

import argparse
import tarfile
import xml.etree.ElementTree as ET
from pathlib import Path


def text(item: ET.Element, suffix: str) -> str:
    for child in item:
        if child.tag.endswith(suffix):
            return (child.text or "").strip()
    return ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("ova", type=Path)
    args = parser.parse_args()
    with tarfile.open(args.ova) as archive:
        ovf_members = [member for member in archive.getmembers() if member.name.endswith(".ovf")]
        if len(ovf_members) != 1:
            raise SystemExit("ERROR: OVA must contain exactly one OVF descriptor")
        handle = archive.extractfile(ovf_members[0])
        if handle is None:
            raise SystemExit("ERROR: Unable to read OVF descriptor")
        root = ET.fromstring(handle.read())

    quantities: dict[str, int] = {}
    for item in root.iter():
        if not item.tag.endswith("Item"):
            continue
        resource_type = text(item, "ResourceType")
        quantity = text(item, "VirtualQuantity")
        if resource_type and quantity:
            quantities[resource_type] = int(quantity)
    if quantities.get("3") != 6:
        raise SystemExit(f"ERROR: OVA vCPU count is {quantities.get('3')}, expected 6")
    if quantities.get("4") != 12288:
        raise SystemExit(f"ERROR: OVA memory is {quantities.get('4')} MiB, expected 12288")
    disks = [element for element in root.iter() if element.tag.endswith("Disk")]
    if not disks:
        raise SystemExit("ERROR: OVA has no virtual disk")
    capacity_mib = None
    for disk in disks:
        attributes = {key.rsplit("}", 1)[-1]: value for key, value in disk.attrib.items()}
        if "capacity" not in attributes:
            continue
        capacity = int(attributes["capacity"])
        units = attributes.get("capacityAllocationUnits", "byte")
        if "2^20" in units:
            capacity_mib = capacity
        elif units == "byte":
            capacity_mib = capacity // (1024 * 1024)
        break
    if capacity_mib != 122880:
        raise SystemExit(f"ERROR: OVA disk is {capacity_mib} MiB, expected 122880")
    if not any(element.tag.endswith("Network") for element in root.iter()):
        raise SystemExit("ERROR: OVA has no network definition")
    if "10" not in quantities:
        raise SystemExit("ERROR: OVA has no virtual network adapter")
    print("OVA metadata passed: 6 vCPU, 12288 MiB RAM, 122880 MiB disk, and NIC")


if __name__ == "__main__":
    main()
