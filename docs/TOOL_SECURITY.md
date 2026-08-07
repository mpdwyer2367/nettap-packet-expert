# Tool and connector security

Tools are disabled by default in this release candidate. Model sharing does not authorize either assistant to reach a network, appliance, file, telemetry feed, or external API.

Before enabling a connector, define:

- customer and operator authorization;
- protocol, endpoint, certificate, authentication, and secret-storage method;
- exact read and write operations;
- input validation, size limits, timeout, retry, and rate limits;
- data minimization, redaction, retention, and tenancy boundaries;
- audit event fields and correlation IDs;
- safe failure behavior;
- human approval for changes; and
- validation and rollback.

Prefer read-only acquisition and analysis. Do not give ordinary users tool-administration permissions. Treat imported tool code as privileged application code and subject it to source review, dependency review, static analysis, isolated testing, and release approval.

Bind a tool only to the assistant that requires it. Validate that the other assistant and unauthorized roles cannot invoke it. URL parameters are not an authorization mechanism; model, tool, and knowledge access must be enforced by Open WebUI and the connector itself.

## Internal evidence-service boundary

The local evidence service is authenticated with an appliance-generated bearer token and stores cases in a dedicated volume. The managed attachment Filter—not a user-selectable tool server—calls it over the internal Docker network. Its `/context` response excludes raw files and packet payloads, declares that live telemetry is not connected, and carries evidence IDs, hashes, parser versions, quality warnings and bounded deterministic findings.

Supported network images follow a different local-only path: the Filter validates PNG/JPEG/WebP signatures and limits, then passes image content to the pinned multimodal Ollama model. Images remain untrusted input and are never treated as proof of hidden configuration or live state.

Do not attach this endpoint to an assistant in production until the connector maps the authenticated Open WebUI user to an independently authorized case role. Possession of a model URL or case ID is not authorization. Raw evidence retrieval, write-capable device control and arbitrary file paths are outside the tool contract.
