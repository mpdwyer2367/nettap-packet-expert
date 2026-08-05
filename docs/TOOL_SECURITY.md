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
