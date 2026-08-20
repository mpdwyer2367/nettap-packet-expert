# Threat model

## Protected assets

Administrator credentials, application secrets, customer chats, uploaded evidence, knowledge, model artifacts, configuration, TLS keys, backups, audit evidence, and the integrity of operational recommendations.

## Primary threats and controls

| Threat | Implemented control | Required external control |
|---|---|---|
| Documented local default credential | Loopback-only binding; explicit password replacement; production blocked until retirement | Named admin, secure workstation, periodic review |
| Network interception | TLS-only production gateway; secure cookies | Customer PKI, DNS, firewall |
| Direct model API exposure | No Ollama host port; internal network | Docker host hardening |
| WebUI bypass | No production WebUI host port | Verify with runtime gate |
| Prompt injection/RAG poisoning | System policy treats evidence as untrusted; guardrail test | Curated knowledge, provenance, human review |
| Cross-assistant prompt or knowledge leakage | One shared hard safety policy plus separate managed prompts, knowledge collections, profile IDs and launchers | Workspace Model binding and negative tests |
| RAG dependency drift or poisoned cache | Exact repository revision, upstream file identity checks, revision-specific path, runtime SHA-256 manifest, remote code disabled | Approved hub access during bootstrap and release review |
| Unauthorized tool execution | Tools disabled by default; user tool administration disabled | Connector allowlist, independent authorization and audit |
| Sensitive packet disclosure | Data-minimization policy and explicit capability boundary | Approved normalization/redaction pipeline |
| Malicious/vulnerable dependency | Digests, SBOM and HIGH/CRITICAL CVE gate | Continuous re-scan and exception governance |
| Registry compromise/update drift | Runtime egress removed; signed source package | Controlled registry, release keys |
| Tenant data exposure | One instance per customer; admin access restricted | Separate hosts/volumes and customer identity policy |
| Destructive operator error | Review/validation/rollback guidance; non-overwriting restore | Change control and least privilege |
| Volume/backup theft | Sensitive-backup warning and restricted permissions | Host/full-disk and backup encryption |
| Hallucinated finding | Evidence/fact/hypothesis separation; behavioral evals | Analyst validation and authoritative tools |
| Citation tampering or broken provenance | Case-scoped observation UUIDs, original evidence hashes, deterministic analysis-output hash, and audited resolution | Signed release evidence and tamper-evident external audit export |
| Cross-case citation reference | Resolver requires both owning case ID and observation ID and returns `404` on mismatch | Per-user case authorization and negative tenant tests |
| Availability loss | Health checks, restart policy, backup/restore | Host redundancy and recovery procedure |

## Accepted architectural limitations

- Single-node service; no automatic failover.
- Open WebUI administrator is highly privileged inside the instance.
- Password activation includes a human confirmation because the upstream UI does not provide a complete forced-first-login state for this deployment.
- A 7B model can produce incorrect or inconsistent answers; model output is advisory.
- The repository does not provide native packet capture, live telemetry collectors, SSO/MFA, centralized audit export, licensing enforcement, or an OVA. The Evidence Workspace performs only its documented local parsing and normalization; it is not a general-purpose decoder or collector.
- The loopback launcher pages select an assistant but are not authentication or authorization controls; Open WebUI and connector access control remain authoritative.

These limitations prevent an unconditional certification claim. They must be reflected in contracts, deployment architecture, acceptance criteria, and the product roadmap.

## Security test requirements

Before commercial approval, test authentication and authorization, session expiry, cookie attributes, TLS configuration, rate and resource exhaustion, upload handling, prompt injection, malicious documents, cross-profile specialist knowledge and tool isolation, launcher selection, combined direct-model policy, backup confidentiality, restore integrity, logging leakage, dependency vulnerabilities, Docker isolation, upgrade/rollback, and loss of upstream registry access.
