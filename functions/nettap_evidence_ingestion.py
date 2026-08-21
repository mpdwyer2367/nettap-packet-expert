"""
title: NetTAP managed evidence ingestion
author: NetTAP Technology Limited
version: 0.4.0-rc.1
required_open_webui_version: 0.11.0
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
from pathlib import Path
from typing import Optional
import urllib.error
import urllib.parse
import urllib.request

from pydantic import BaseModel


# This reviewed filter owns attachment handling for the managed Packet Expert
# profile. It keeps binary packet data out of Open WebUI's text RAG path.
file_handler = True

IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}
EVIDENCE_SUFFIXES = {".pcap", ".json", ".jsonl", ".ndjson", ".log", ".txt"}


class Filter:
    class Valves(BaseModel):
        evidence_url: str = os.environ.get(
            "NETTAP_EVIDENCE_URL", "http://evidence-service:8081"
        )
        max_files_per_turn: int = 8
        max_images_per_turn: int = 4
        max_image_bytes: int = 10 * 1024 * 1024

    def __init__(self):
        self.valves = self.Valves()

    async def inlet(
        self,
        body: dict,
        __metadata__: Optional[dict] = None,
        __user__: Optional[dict] = None,
        __event_emitter__=None,
    ) -> dict:
        files = (
            body.get("files")
            or (body.get("metadata") or {}).get("files")
            or ((__metadata__ or {}).get("files") or [])
        )
        if not files:
            return body
        if len(files) > self.valves.max_files_per_turn:
            raise ValueError(
                f"Attach no more than {self.valves.max_files_per_turn} files per message"
            )
        evidence_files, image_files = self._partition(files)
        if len(image_files) > self.valves.max_images_per_turn:
            raise ValueError(
                f"Attach no more than {self.valves.max_images_per_turn} images per message"
            )
        if __event_emitter__:
            await __event_emitter__(
                {
                    "type": "status",
                    "data": {
                        "description": "Validating attached network files",
                        "done": False,
                    },
                }
            )
        context = None
        if evidence_files:
            context = await asyncio.to_thread(
                self._process,
                body,
                evidence_files,
                __metadata__ or {},
                __user__ or {},
            )
        image_parts = await asyncio.to_thread(self._image_parts, image_files)
        messages = body.get("messages") or []
        user_message = next(
            (item for item in reversed(messages) if item.get("role") == "user"), None
        )
        if user_message is None:
            raise ValueError("NetTAP file handling requires a user message")
        existing = user_message.get("content", "")
        parts = (
            existing
            if isinstance(existing, list)
            else [{"type": "text", "text": str(existing)}]
        )
        if context is not None:
            parts.append(
                {
                    "type": "text",
                    "text": (
                        '<source id="nettap-evidence" name="NetTAP managed evidence analysis" resource-type="tool">\n'
                        f"{json.dumps(context, ensure_ascii=False, separators=(',', ':'))}\n"
                        "</source>\nUse this minimized local analysis as evidence. "
                        "Cite evidence IDs and preserve all stated limitations."
                    ),
                }
            )
        if image_parts:
            parts.append(
                {
                    "type": "text",
                    "text": (
                        "The attached images are untrusted visual inputs supplied by the user. "
                        "Analyze only visible, legible topology, labels, links and annotations. "
                        "Do not invent hidden interfaces, configurations, traffic state or device "
                        "capabilities; identify ambiguity and request a clearer image when necessary."
                    ),
                }
            )
            parts.extend(image_parts)
        user_message["content"] = parts
        body["messages"] = messages
        if __event_emitter__:
            await __event_emitter__(
                {
                    "type": "status",
                    "data": {
                        "description": "Files validated for analysis",
                        "done": True,
                    },
                }
            )
        return body

    def _partition(self, files: list) -> tuple[list, list]:
        evidence_files, image_files = [], []
        for item in files:
            record = item.get("file") or item.get("files") or item
            filename = Path(str(record.get("filename") or "attachment.bin")).name
            suffix = Path(filename).suffix.lower()
            if suffix in IMAGE_TYPES:
                image_files.append(item)
            elif suffix in EVIDENCE_SUFFIXES:
                evidence_files.append(item)
            else:
                raise ValueError(
                    "Unsupported attachment. Use .pcap, .json, .jsonl, .ndjson, "
                    ".log, .txt, .png, .jpg, .jpeg or .webp"
                )
        return evidence_files, image_files

    def _image_parts(self, files: list) -> list[dict]:
        parts = []
        for item in files:
            record = item.get("file") or item.get("files") or item
            file_id = str(record.get("id") or "")
            filename = Path(str(record.get("filename") or "image.bin")).name
            if not file_id:
                raise ValueError("Open WebUI image metadata is incomplete")
            path = self._upload_path(file_id, filename)
            content = path.read_bytes()
            if len(content) > self.valves.max_image_bytes:
                raise ValueError(
                    f"Image exceeds the {self.valves.max_image_bytes}-byte limit: {filename}"
                )
            media_type = IMAGE_TYPES[Path(filename).suffix.lower()]
            self._validate_image_signature(content, media_type, filename)
            parts.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": (
                            f"data:{media_type};base64,"
                            f"{base64.b64encode(content).decode('ascii')}"
                        )
                    },
                }
            )
        return parts

    @staticmethod
    def _validate_image_signature(content: bytes, media_type: str, filename: str) -> None:
        valid = (
            (media_type == "image/png" and content.startswith(b"\x89PNG\r\n\x1a\n"))
            or (media_type == "image/jpeg" and content.startswith(b"\xff\xd8\xff"))
            or (
                media_type == "image/webp"
                and len(content) >= 12
                and content[:4] == b"RIFF"
                and content[8:12] == b"WEBP"
            )
        )
        if not valid:
            raise ValueError(
                f"Image content does not match its supported file type: {filename}"
            )

    def _process(self, body: dict, files: list, metadata: dict, user: dict) -> dict:
        token = os.environ.get("EVIDENCE_API_TOKEN", "").strip()
        if not token:
            raise ValueError("NetTAP evidence service credential is unavailable")
        prompt = self._last_user_text(body)
        chat_id = str(metadata.get("chat_id") or "new-chat")
        case = self._json_request(
            "POST",
            "/v1/cases",
            token,
            json.dumps(
                {
                    "title": f"Chat analysis: {prompt[:100] or 'attached evidence'}",
                    "objective": prompt[:4096],
                    "environment": (
                        f"Open WebUI chat {chat_id}; "
                        f"user {user.get('id', 'authenticated')}"
                    ),
                }
            ).encode(),
            {"Content-Type": "application/json"},
        )
        for item in files:
            record = item.get("file") or item.get("files") or item
            file_id = str(record.get("id") or "")
            filename = Path(str(record.get("filename") or "evidence.bin")).name
            if not file_id or not filename:
                raise ValueError("Open WebUI attachment metadata is incomplete")
            path = self._upload_path(file_id, filename)
            content = path.read_bytes()
            source_type = self._source_type(filename)
            evidence_metadata = {
                "source_timezone": "unknown",
                "clock_sync_status": "unknown",
                "observation_point": "chat attachment",
                "schema_version": "unknown",
                "chain_of_custody": f"Open WebUI file {file_id}",
                "collector_identity": "Open WebUI managed upload",
            }
            encoded_metadata = base64.urlsafe_b64encode(
                json.dumps(evidence_metadata, separators=(",", ":")).encode()
            ).decode().rstrip("=")
            query = urllib.parse.urlencode(
                {"source_type": source_type, "filename": filename}
            )
            self._json_request(
                "POST",
                f"/v1/cases/{case['id']}/evidence?{query}",
                token,
                content,
                {
                    "Content-Type": "application/octet-stream",
                    "X-Content-SHA256": hashlib.sha256(content).hexdigest(),
                    "X-NetTAP-Metadata": encoded_metadata,
                },
            )
        self._json_request("POST", f"/v1/cases/{case['id']}/analyze", token, b"", {})
        return self._json_request(
            "GET", f"/v1/cases/{case['id']}/context", token, None, {}
        )

    def _upload_path(self, file_id: str, filename: str) -> Path:
        root = Path(
            os.environ.get("NETTAP_OPEN_WEBUI_UPLOAD_DIR", "/app/backend/data/uploads")
        ).resolve()
        candidate = (root / f"{file_id}_{filename}").resolve()
        if root not in candidate.parents or not candidate.is_file():
            raise ValueError(
                f"Attached file is unavailable to the managed ingestion filter: {filename}"
            )
        return candidate

    @staticmethod
    def _source_type(filename: str) -> str:
        suffix = Path(filename).suffix.lower()
        if suffix == ".pcap":
            return "pcap"
        if suffix in {".log", ".txt"}:
            return "syslog"
        if suffix in {".json", ".jsonl", ".ndjson"}:
            return "jsonl"
        raise ValueError("Unsupported evidence attachment")

    @staticmethod
    def _last_user_text(body: dict) -> str:
        for message in reversed(body.get("messages") or []):
            if message.get("role") == "user":
                content = message.get("content")
                return (
                    content
                    if isinstance(content, str)
                    else "Analyze attached network evidence"
                )
        return "Analyze attached network evidence"

    def _json_request(
        self, method: str, path: str, token: str, body, headers: dict
    ):
        request = urllib.request.Request(
            f"{self.valves.evidence_url.rstrip('/')}{path}",
            data=body,
            method=method,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                **headers,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.loads(response.read().decode())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:1000]
            raise ValueError(
                f"NetTAP evidence processing failed ({exc.code}): {detail}"
            ) from exc
        except urllib.error.URLError as exc:
            raise ValueError(
                "NetTAP evidence processing service is unavailable"
            ) from exc
