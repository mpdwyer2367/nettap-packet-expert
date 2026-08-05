#!/usr/bin/env python3
"""Download and verify the exact local embedding model during controlled bootstrap."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import tempfile
import time

from huggingface_hub import model_info, snapshot_download
from sentence_transformers import SentenceTransformer


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"ERROR: required environment variable is empty: {name}")
    return value


repository = required("RAG_EMBEDDING_MODEL_ID")
revision = required("RAG_EMBEDDING_MODEL_REVISION")
target = Path(required("RAG_EMBEDDING_MODEL"))
state_path = Path(os.environ.get("RAG_EMBEDDING_STATE", "/app/backend/data/nettap-embedding-model.json"))

target.mkdir(parents=True, exist_ok=True)
information = model_info(repo_id=repository, revision=revision, files_metadata=True)
if information.sha != revision:
    raise SystemExit(
        f"ERROR: embedding repository resolved to {information.sha}; expected exact revision {revision}"
    )
snapshot_download(
    repo_id=repository,
    revision=revision,
    local_dir=str(target),
    force_download=True,
)

upstream = {}
for sibling in information.siblings:
    relative = sibling.rfilename
    lfs = getattr(sibling, "lfs", None)
    lfs_sha256 = lfs.get("sha256") if isinstance(lfs, dict) else getattr(lfs, "sha256", None)
    if lfs_sha256:
        upstream[relative] = {"algorithm": "sha256", "digest": lfs_sha256}
    elif sibling.blob_id:
        upstream[relative] = {"algorithm": "git-sha1", "digest": sibling.blob_id}
    else:
        raise SystemExit(f"ERROR: upstream did not provide integrity metadata for {relative}")

downloaded = {
    path.relative_to(target).as_posix(): path
    for path in target.rglob("*")
    if path.is_file() and ".cache" not in path.parts
}
if set(downloaded) != set(upstream):
    missing = sorted(set(upstream) - set(downloaded))
    extra = sorted(set(downloaded) - set(upstream))
    raise SystemExit(f"ERROR: embedding snapshot file-set mismatch; missing={missing}, extra={extra}")

for relative, identity in upstream.items():
    contents = downloaded[relative].read_bytes()
    if identity["algorithm"] == "sha256":
        actual = hashlib.sha256(contents).hexdigest()
    else:
        actual = hashlib.sha1(f"blob {len(contents)}\0".encode() + contents).hexdigest()
    if actual != identity["digest"]:
        raise SystemExit(
            f"ERROR: embedding file identity mismatch for {relative}: expected {identity['digest']}, received {actual}"
        )

model = SentenceTransformer(
    str(target),
    device="cpu",
    trust_remote_code=False,
    local_files_only=True,
)
vector = model.encode("NetTAP offline embedding verification", normalize_embeddings=True)
dimension = int(vector.shape[-1])
if dimension <= 0:
    raise SystemExit("ERROR: local embedding model returned an invalid vector dimension")

files = []
aggregate = hashlib.sha256()
for relative, path in sorted(downloaded.items()):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    files.append({
        "path": relative,
        "sha256": digest,
        "bytes": path.stat().st_size,
        "upstream": upstream[relative],
    })
    aggregate.update(relative.encode("utf-8"))
    aggregate.update(b"\0")
    aggregate.update(digest.encode("ascii"))
    aggregate.update(b"\n")

state = {
    "schema_version": 1,
    "repository": repository,
    "revision": revision,
    "model_path": str(target),
    "embedding_dimension": dimension,
    "aggregate_sha256": aggregate.hexdigest(),
    "files": files,
    "verified_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}
state_path.parent.mkdir(parents=True, exist_ok=True)
with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=state_path.parent, delete=False) as handle:
    json.dump(state, handle, indent=2, sort_keys=True)
    handle.write("\n")
    temporary = Path(handle.name)
os.chmod(temporary, 0o600)
os.replace(temporary, state_path)

print(f"Pinned embedding model ready: {repository}@{revision}")
print(f"Local path: {target}")
print(f"Embedding dimension: {dimension}")
print(f"Aggregate SHA-256: {state['aggregate_sha256']}")
