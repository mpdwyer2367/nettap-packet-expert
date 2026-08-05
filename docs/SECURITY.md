# Security and evidence boundary

NetTAP Packet Expert is advisory decision support. It is not a security enforcement control or source of forensic truth.

Implemented candidate controls include generated bootstrap credentials, explicit bootstrap retirement, disabled signup and risky WebUI features, an 8-hour session, secure production cookies, TLS termination, internal-only WebUI/Ollama networks, no host Ollama port, temporary-only model registry egress, dropped Linux capabilities, no-new-privileges, resource/PID limits, log rotation, immutable digest enforcement, SBOM/CVE tooling, protected backups, non-overwriting restore, and fail-closed certification gates.

Required customer controls include hardened/patch-managed hosts, customer PKI and firewalling, disk and backup encryption, named administrators, secure time, endpoint monitoring, data classification and retention, incident response, controlled evidence normalization, centralized log handling, and change approval.

Uploaded and retrieved content is untrusted. It may contain prompt injection, false data, sensitive payload, or poisoned knowledge. Minimize it, validate provenance, restrict access, and require human review. Packet Expert output must be validated with authoritative network/security tools before operational or forensic action.

Open WebUI administrators are root-equivalent within the application. Do not share one instance across customers. SSO/MFA, native telemetry collectors, packet capture, centralized immutable audit export, high availability, licensing enforcement, and an OVA are outside this release scope.

Review [the threat model](THREAT_MODEL.md), [production architecture](PRODUCTION_ARCHITECTURE.md), and [commercial gates](COMMERCIAL_RELEASE_GATES.md).
