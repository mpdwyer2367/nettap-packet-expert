#!/usr/bin/env python3
"""Compute the Git tree identity of a source archive without trusting extraction paths."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import PurePosixPath
import sys
import tarfile


class ArchiveError(RuntimeError):
    pass


def git_object(kind: str, content: bytes) -> bytes:
    return hashlib.sha1(f"{kind} {len(content)}\0".encode() + content).digest()


def insert(root: dict, path: PurePosixPath, mode: str, content: bytes):
    node = root
    for part in path.parts[:-1]:
        existing = node.setdefault(part, {"kind": "tree", "children": {}})
        if existing["kind"] != "tree":
            raise ArchiveError(f"archive path collides with a file: {path}")
        node = existing["children"]
    name = path.parts[-1]
    if name in node:
        raise ArchiveError(f"duplicate archive path: {path}")
    node[name] = {"kind": "blob", "mode": mode, "content": content}


def tree_digest(children: dict) -> bytes:
    entries = []
    for name, node in sorted(
        children.items(), key=lambda item: (item[0] + ("/" if item[1]["kind"] == "tree" else "")).encode()
    ):
        encoded_name = name.encode("utf-8")
        if b"\0" in encoded_name or b"/" in encoded_name:
            raise ArchiveError(f"invalid Git tree name: {name!r}")
        if node["kind"] == "tree":
            mode = "40000"
            identity = tree_digest(node["children"])
        else:
            mode = node["mode"]
            identity = git_object("blob", node["content"])
        entries.append(mode.encode() + b" " + encoded_name + b"\0" + identity)
    return git_object("tree", b"".join(entries))


def archive_tree(path: str) -> tuple[str, str]:
    roots = set()
    files = {}
    with tarfile.open(path, "r:gz") as archive:
        for member in archive.getmembers():
            pure = PurePosixPath(member.name)
            if pure.is_absolute() or ".." in pure.parts or not pure.parts:
                raise ArchiveError(f"unsafe archive path: {member.name}")
            roots.add(pure.parts[0])
            if member.isdir():
                continue
            if len(pure.parts) < 2:
                raise ArchiveError("source files must be below one archive prefix")
            relative = PurePosixPath(*pure.parts[1:])
            if member.isfile():
                extracted = archive.extractfile(member)
                if extracted is None:
                    raise ArchiveError(f"unable to read archive file: {member.name}")
                content = extracted.read()
                mode = "100755" if member.mode & 0o111 else "100644"
            elif member.issym():
                content = member.linkname.encode("utf-8")
                mode = "120000"
            else:
                raise ArchiveError(f"unsupported archive member type: {member.name}")
            if relative in files:
                raise ArchiveError(f"duplicate archive path: {relative}")
            files[relative] = (mode, content)
    if len(roots) != 1:
        raise ArchiveError(f"archive must contain exactly one prefix; received {sorted(roots)}")
    root = {}
    for relative, (mode, content) in files.items():
        insert(root, relative, mode, content)
    return next(iter(roots)), tree_digest(root).hex()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive")
    parser.add_argument("--expected-prefix", required=True)
    parser.add_argument("--expected-tree", required=True)
    args = parser.parse_args()
    prefix, identity = archive_tree(args.archive)
    if prefix != args.expected_prefix:
        raise ArchiveError(f"archive prefix {prefix!r} does not match {args.expected_prefix!r}")
    if identity != args.expected_tree:
        raise ArchiveError(f"archive Git tree {identity} does not match {args.expected_tree}")
    print(f"Archive Git tree: {identity}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ArchiveError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
