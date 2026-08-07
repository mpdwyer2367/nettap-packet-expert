"""Authenticated internal evidence-analysis HTTP API."""

from __future__ import annotations

import base64
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
import re
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

from . import SERVICE_VERSION
from .database import ConflictError, NotFoundError, Repository
from .parsers import ParseError
from .service import EvidenceService, ValidationError


CASE_PATH = re.compile(r"^/v1/cases/([0-9a-f-]{36})$")
EVIDENCE_PATH = re.compile(r"^/v1/cases/([0-9a-f-]{36})/evidence$")
ANALYZE_PATH = re.compile(r"^/v1/cases/([0-9a-f-]{36})/analyze$")
CONTEXT_PATH = re.compile(r"^/v1/cases/([0-9a-f-]{36})/context$")
REPORT_PATH = re.compile(r"^/v1/cases/([0-9a-f-]{36})/report\.md$")
OBSERVATION_PATH = re.compile(
    r"^/v1/cases/([0-9a-f-]{36})/observations/([0-9a-f-]{36})$"
)
ANALYSIS_PATH = re.compile(
    r"^/v1/cases/([0-9a-f-]{36})/analyses/([0-9a-f-]{36})$"
)


def openapi_spec() -> dict[str, Any]:
    """Expose only read-only, minimized case operations to the assistant."""
    security = [{"bearerAuth": []}]
    case_parameter = {
        "name": "case_id",
        "in": "path",
        "required": True,
        "description": "Evidence Workspace case UUID supplied by the authorized user.",
        "schema": {"type": "string", "format": "uuid"},
    }
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "NetTAP Evidence Workspace",
            "version": SERVICE_VERSION,
            "description": "Read-only access to uploaded, validated and minimized NetTAP evidence cases. Raw evidence is never returned.",
        },
        "paths": {
            "/v1/tool/cases": {
                "get": {
                    "operationId": "list_nettap_evidence_cases",
                    "summary": "List authorized evidence cases",
                    "description": "List local cases and evidence counts. This does not return raw evidence.",
                    "security": security,
                    "responses": {"200": {"description": "Case summaries"}},
                }
            },
            "/v1/cases/{case_id}/context": {
                "get": {
                    "operationId": "get_nettap_case_context",
                    "summary": "Get minimized analysis context for one case",
                    "description": "Return provenance, quality warnings, deterministic analysis and evidence-bound findings. Raw evidence and secrets are excluded.",
                    "parameters": [case_parameter],
                    "security": security,
                    "responses": {"200": {"description": "Minimized case context"}},
                }
            },
        },
        "components": {
            "securitySchemes": {
                "bearerAuth": {"type": "http", "scheme": "bearer"}
            }
        },
    }


def handler_factory(
    service: EvidenceService, repository: Repository, api_token: str, max_upload_bytes: int
) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "NetTAPEvidence/1"
        sys_version = ""

        def do_GET(self) -> None:
            route = urlparse(self.path).path
            if route == "/health":
                self.send_json(
                    HTTPStatus.OK,
                    {"status": "healthy", "service": "nettap-evidence", "version": SERVICE_VERSION},
                    authenticated=False,
                )
                return
            if route == "/openapi.json":
                self.send_json(HTTPStatus.OK, openapi_spec(), authenticated=False)
                return
            if not self.authorized():
                return
            try:
                if route == "/v1/configuration":
                    self.send_json(HTTPStatus.OK, service.configuration())
                    return
                if route == "/v1/tool/cases":
                    self.send_json(HTTPStatus.OK, service.tool_cases())
                    return
                if route == "/v1/cases":
                    self.send_json(HTTPStatus.OK, {"cases": repository.list_cases()})
                    return
                match = CASE_PATH.match(route)
                if match:
                    self.send_json(HTTPStatus.OK, repository.get_case(match.group(1)))
                    return
                match = OBSERVATION_PATH.match(route)
                if match:
                    self.send_json(
                        HTTPStatus.OK,
                        repository.get_observation(match.group(1), match.group(2)),
                    )
                    return
                match = ANALYSIS_PATH.match(route)
                if match:
                    self.send_json(
                        HTTPStatus.OK,
                        repository.get_analysis(match.group(1), match.group(2)),
                    )
                    return
                match = CONTEXT_PATH.match(route)
                if match:
                    self.send_json(HTTPStatus.OK, service.context(match.group(1)))
                    return
                match = REPORT_PATH.match(route)
                if match:
                    self.send_bytes(
                        HTTPStatus.OK,
                        service.markdown_report(match.group(1)).encode("utf-8"),
                        "text/markdown; charset=utf-8",
                    )
                    return
                self.send_error_json(HTTPStatus.NOT_FOUND, "route not found")
            except Exception as exc:  # routed to narrow public error classes
                self.handle_application_error(exc)

        def do_POST(self) -> None:
            route = urlparse(self.path).path
            if not self.authorized():
                return
            try:
                if route == "/v1/cases":
                    payload = self.read_json(64 * 1024)
                    self.send_json(HTTPStatus.CREATED, service.create_case(payload))
                    return
                match = EVIDENCE_PATH.match(route)
                if match:
                    query = parse_qs(urlparse(self.path).query, keep_blank_values=True)
                    source_type = single_query_value(query, "source_type")
                    filename = single_query_value(query, "filename")
                    metadata = self.metadata_header()
                    body = self.read_body(max_upload_bytes)
                    result = service.ingest(
                        match.group(1),
                        source_type,
                        filename,
                        body,
                        metadata,
                        self.headers.get("X-Content-SHA256"),
                    )
                    self.send_json(HTTPStatus.CREATED, result)
                    return
                match = ANALYZE_PATH.match(route)
                if match:
                    self.require_empty_body()
                    self.send_json(HTTPStatus.OK, service.analyze(match.group(1)))
                    return
                self.send_error_json(HTTPStatus.NOT_FOUND, "route not found")
            except Exception as exc:  # routed to narrow public error classes
                self.handle_application_error(exc)

        def authorized(self) -> bool:
            expected = f"Bearer {api_token}"
            received = self.headers.get("Authorization", "")
            if not hmac.compare_digest(received, expected):
                self.send_error_json(HTTPStatus.UNAUTHORIZED, "valid bearer token required")
                return False
            return True

        def read_body(self, maximum: int) -> bytes:
            raw_length = self.headers.get("Content-Length")
            if raw_length is None:
                raise ValidationError("Content-Length is required")
            try:
                length = int(raw_length)
            except ValueError as exc:
                raise ValidationError("Content-Length is invalid") from exc
            if length < 0 or length > maximum:
                raise PayloadTooLargeError(f"request exceeds the {maximum}-byte limit")
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValidationError("request body ended before Content-Length")
            return body

        def read_json(self, maximum: int) -> dict[str, Any]:
            body = self.read_body(maximum)
            try:
                payload = json.loads(body)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValidationError("request body must be valid UTF-8 JSON") from exc
            if not isinstance(payload, dict):
                raise ValidationError("request JSON must be an object")
            return payload

        def metadata_header(self) -> dict[str, Any]:
            encoded = self.headers.get("X-NetTAP-Metadata", "")
            if not encoded:
                return {}
            if len(encoded) > 16 * 1024:
                raise ValidationError("X-NetTAP-Metadata is too large")
            try:
                padding = "=" * (-len(encoded) % 4)
                decoded = base64.urlsafe_b64decode(encoded + padding)
                metadata = json.loads(decoded)
            except (ValueError, UnicodeDecodeError, json.JSONDecodeError, RecursionError) as exc:
                raise ValidationError("X-NetTAP-Metadata must be base64url-encoded JSON") from exc
            if not isinstance(metadata, dict):
                raise ValidationError("X-NetTAP-Metadata JSON must be an object")
            return metadata

        def require_empty_body(self) -> None:
            length = self.headers.get("Content-Length", "0")
            try:
                value = int(length)
            except ValueError as exc:
                raise ValidationError("Content-Length is invalid") from exc
            if value:
                raise ValidationError("this endpoint does not accept a request body")

        def handle_application_error(self, exc: Exception) -> None:
            if isinstance(exc, NotFoundError):
                self.send_error_json(HTTPStatus.NOT_FOUND, str(exc))
            elif isinstance(exc, ConflictError):
                self.send_error_json(HTTPStatus.CONFLICT, str(exc))
            elif isinstance(exc, PayloadTooLargeError):
                self.send_error_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, str(exc))
            elif isinstance(exc, (ValidationError, ParseError)):
                self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            else:
                self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, "internal service error")

        def send_json(
            self, status: HTTPStatus, payload: Any, authenticated: bool = True
        ) -> None:
            del authenticated
            data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self.send_bytes(status, data, "application/json; charset=utf-8")

        def send_error_json(self, status: HTTPStatus, message: str) -> None:
            self.send_json(status, {"error": message})

        def send_bytes(
            self,
            status: HTTPStatus,
            data: bytes,
            content_type: str,
            authenticated: bool = True,
        ) -> None:
            del authenticated
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
                "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
            )
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, format_string: str, *args: Any) -> None:
            # Do not emit bearer tokens, query strings, filenames or evidence content.
            print(f"nettap-evidence client={self.client_address[0]} method={self.command} status={args[1] if len(args) > 1 else '-'}")

    return Handler


class PayloadTooLargeError(ValueError):
    pass


def single_query_value(query: dict[str, list[str]], key: str) -> str:
    values = query.get(key, [])
    if len(values) != 1 or not values[0]:
        raise ValidationError(f"query parameter {key} is required exactly once")
    return values[0]


def serve(
    host: str,
    port: int,
    service: EvidenceService,
    repository: Repository,
    api_token: str,
    max_upload_bytes: int,
) -> None:
    server = ThreadingHTTPServer(
        (host, port), handler_factory(service, repository, api_token, max_upload_bytes)
    )
    server.daemon_threads = True
    print(f"NetTAP evidence service {SERVICE_VERSION} listening on {host}:{port}")
    server.serve_forever()
