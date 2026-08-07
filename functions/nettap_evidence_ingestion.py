"""
title: NetTAP managed evidence ingestion
author: NetTAP Technology Limited
version: 0.3.0-rc.7
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


# This reviewed filter owns attachment handling for the managed model. It keeps
# binary packet data out of Open WebUI's text RAG path.
file_handler = True


class Filter:
    class Valves(BaseModel):
        evidence_url: str = os.environ.get("NETTAP_EVIDENCE_URL", "http://evidence-service:8081")
        max_files_per_turn: int = 8

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
            raise ValueError(f"Attach no more than {self.valves.max_files_per_turn} evidence files per message")
        if __event_emitter__:
            await __event_emitter__({"type": "status", "data": {"description": "Validating attached network evidence", "done": False}})
        context = await asyncio.to_thread(self._process, body, files, __metadata__ or {}, __user__ or {})
        messages = body.get("messages") or []
        if not messages or messages[-1].get("role") != "user":
            raise ValueError("NetTAP evidence ingestion requires a user message")
        messages[-1]["content"] = (
            f"{messages[-1].get('content', '')}\n\n"
            "<source id=\"nettap-evidence\" name=\"NetTAP managed evidence analysis\" resource-type=\"tool\">\n"
            f"{json.dumps(context, ensure_ascii=False, separators=(',', ':'))}\n"
            "</source>\n"
            "Use this minimized local analysis as evidence. Cite evidence IDs and preserve all stated limitations."
        )
        body["messages"] = messages
        if __event_emitter__:
            await __event_emitter__({"type": "status", "data": {"description": "Evidence validated and minimized for analysis", "done": True}})
        return body

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
            json.dumps({
                "title": f"Chat analysis: {prompt[:100] or 'attached evidence'}",
                "objective": prompt[:4096],
                "environment": f"Open WebUI chat {chat_id}; user {user.get('id', 'authenticated')}",
            }).encode(),
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
            query = urllib.parse.urlencode({"source_type": source_type, "filename": filename})
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
        return self._json_request("GET", f"/v1/cases/{case['id']}/context", token, None, {})

    def _upload_path(self, file_id: str, filename: str) -> Path:
        root = Path(
            os.environ.get("NETTAP_OPEN_WEBUI_UPLOAD_DIR", "/app/backend/data/uploads")
        ).resolve()
        candidate = (root / f"{file_id}_{filename}").resolve()
        if root not in candidate.parents or not candidate.is_file():
            raise ValueError(f"Attached file is unavailable to the managed ingestion filter: {filename}")
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
        raise ValueError("Unsupported attachment. Use .pcap, .json, .jsonl, .ndjson, .log or .txt")

    @staticmethod
    def _last_user_text(body: dict) -> str:
        for message in reversed(body.get("messages") or []):
            if message.get("role") == "user":
                content = message.get("content")
                return content if isinstance(content, str) else "Analyze attached network evidence"
        return "Analyze attached network evidence"

    def _json_request(self, method: str, path: str, token: str, body, headers: dict):
        request = urllib.request.Request(
            f"{self.valves.evidence_url.rstrip('/')}{path}",
            data=body,
            method=method,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json", **headers},
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.loads(response.read().decode())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:1000]
            raise ValueError(f"NetTAP evidence processing failed ({exc.code}): {detail}") from exc
        except urllib.error.URLError as exc:
            raise ValueError("NetTAP evidence processing service is unavailable") from exc
