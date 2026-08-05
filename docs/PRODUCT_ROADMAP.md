# Product roadmap

This roadmap separates implemented candidate capability from future commercial editions. Dates and commitments require product approval.

## Stage 0.3 — unified assistant integration candidate

Implemented in `0.3.0-rc.3` source:

- one shared Qwen2.5 7B base, one combined `nettap-ai` model, and one Ollama volume;
- one combined Network & Visibility, Packet Expert, and cross-domain reasoning policy;
- one Open WebUI account, chat, administration, and backup surface;
- stateless assistant-specific launchers on local ports 3000 and 3001;
- two thin profile manifests with separate specialist knowledge and suggested starts;
- exact-revision offline embedding cache, API-managed knowledge/profile reconciliation, and a deterministic retrieval proof;
- unified `nettap-ai` administration command;
- in-place 0.2 environment migration with retained Compose volume identity;
- API-contract idempotence, combined-capability, launcher, and profile-isolation smoke controls; and
- migration, customization, knowledge, tool-security, and administration guidance.

Exit: fresh and upgrade runtime reports on macOS and Windows, measured single-model storage, Workspace Model and knowledge-isolation acceptance, backup/restore/rollback, security review, and signed release decision.

## Stage 1 — hardened advisory candidate

Implemented in `0.2.0-rc.1`:

- Qwen2.5 7B plus versioned NetTAP policy
- local evaluation and TLS single-customer profiles
- generated administrator activation and fail-closed production start
- internal-only model runtime and temporary registry egress
- immutable container digests and expected base-model identity
- metadata audit logs, resource/log limits, backup/restore, SBOM/CVE gate
- signed source packaging, runtime verification, and explicit certification evidence gate

Exit: physical macOS/Windows reports, expanded model eval, recovery test, penetration test, legal/branding, support, signed acceptance.

## Stage 2 — sellable managed software appliance

Required before a licensed customer offer:

- entitlement/license service with offline grace policy and privacy review
- installer/upgrade manager with signed updates, rollback, migration and EOL policy
- enterprise identity profile (OIDC/SAML, MFA, lifecycle and group mapping)
- centralized immutable audit export and customer SIEM integration
- tested performance tiers, concurrency limits and supported-host matrix
- support bundle with redaction, SLA/escalation, vulnerability response and recovery objectives
- customer deployment automation and acceptance package

Exit: commercially approved software distribution for the defined host matrix. This is still not an OVA.

## Stage 3 — NetTAP visibility integration

Build collectors as separate least-privilege services, not inside the language-model process:

```mermaid
flowchart LR
    N["NetTAP TAP / NPB"] --> C["Approved collectors"]
    C --> V["Normalize, validate, redact"]
    V --> S["Evidence store / search"]
    S --> A["Read-only retrieval API"]
    A --> P["NetTAP AI in authorized evidence mode"]
```

Prioritized inputs:

1. IPFIX/NetFlow metadata with exporter templates, clock/source validation and retention;
2. syslog with authenticated TLS where supported;
3. SNMPv3 and read-only gNMI with vendor/model capability profiles;
4. customer-approved REST/webhook/file feeds with schema validation;
5. PCAP through a sandboxed, resource-limited TShark extraction service that returns normalized metadata by default.

Every connector needs authorization, provenance, tenant isolation, rate/size limits, schema versioning, back-pressure, duplicate handling, encryption, secret rotation, audit, retention, health, test fixtures and failure semantics. Raw packet payload must not be sent to the LLM by default.

Exit: feed-specific conformance and security reports plus evidence that the assistant accurately labels data as live, uploaded, retrieved, or unavailable.

## Stage 4 — virtual appliance

Build separate AMD64 and ARM64 images from a minimal supported Linux OS using reproducible Packer pipelines. Package VMware-compatible OVF/OVA only against a supported hypervisor/guest architecture matrix; do not claim an ARMv8 VirtualBox builder unless Packer/VirtualBox officially supports that exact path.

Required appliance controls:

- first-boot network/DNS/NTP/PKI/admin/licensing wizard
- signed OS/container/model update channels with A/B or snapshot rollback
- secure boot where supported, host firewall, disk encryption/key handling
- `mvi-cli` for status, feeds, certificates, backup, diagnostics and reset
- appliance health, support bundle, factory reset and recovery media
- SBOM for OS and application, CIS hardening evidence, vulnerability and penetration tests
- VMware/VirtualBox validation on every advertised architecture

Exit: signed OVA/OVF/VMDK, checksums, installation guide, platform acceptance, recovery test, support lifecycle and commercial approval.

## Stage 5 — scale and resilience

For larger teams or HA, replace single-node SQLite/vector state with supported PostgreSQL, Redis and external vector/object storage; add replica-safe session/state design, load balancing, observability, capacity tests, failover, backup consistency and disaster-recovery exercises. This is a different certification scope.
