# Threat model

## Protected assets

Administrator credentials, application secrets, customer chats, uploaded evidence, knowledge, model artifacts, configuration, TLS keys, backups, audit evidence, and the integrity of operational recommendations.

## Primary threats and controls

| Threat | Implemented control | Required external control |
|---|---|---|
| Shared/default credential | Unique generated bootstrap password; production blocked until retirement | Named admin, secure workstation, periodic review |
| Network interception | TLS-only production gateway; secure cookies | Customer PKI, DNS, firewall |
| Direct model API exposure | No Ollama host port; internal network | Docker host hardening |
| WebUI bypass | No production WebUI host port | Verify with runtime gate |
| Prompt injection/RAG poisoning | System policy treats evidence as untrusted; guardrail test | Curated knowledge, provenance, human review |
| Cross-assistant prompt or knowledge leakage | Separate Modelfiles, manifests, knowledge collections and launchers | Workspace Model binding and negative tests |
| Unauthorized tool execution | Tools disabled by default; user tool administration disabled | Connector allowlist, independent authorization and audit |
| Sensitive packet disclosure | Data-minimization policy and explicit capability boundary | Approved normalization/redaction pipeline |
| Malicious/vulnerable dependency | Digests, SBOM and HIGH/CRITICAL CVE gate | Continuous re-scan and exception governance |
| Registry compromise/update drift | Runtime egress removed; signed source package | Controlled registry, release keys |
| Tenant data exposure | One instance per customer; admin access restricted | Separate hosts/volumes and customer identity policy |
| Destructive operator error | Review/validation/rollback guidance; non-overwriting restore | Change control and least privilege |
| Volume/backup theft | Sensitive-backup warning and restricted permissions | Host/full-disk and backup encryption |
| Hallucinated finding | Evidence/fact/hypothesis separation; behavioral evals | Analyst validation and authoritative tools |
| Availability loss | Health checks, restart policy, backup/restore | Host redundancy and recovery procedure |

## Accepted architectural limitations

- Single-node service; no automatic failover.
- Open WebUI administrator is highly privileged inside the instance.
- Password activation includes a human confirmation because the upstream UI does not provide a complete forced-first-login state for this deployment.
- A 7B model can produce incorrect or inconsistent answers; model output is advisory.
- The repository does not provide native packet capture, telemetry collectors, evidence normalization, SSO/MFA, centralized audit export, licensing enforcement, or an OVA.
- The loopback launcher pages select an assistant but are not authentication or authorization controls; Open WebUI and connector access control remain authoritative.

These limitations prevent an unconditional certification claim. They must be reflected in contracts, deployment architecture, acceptance criteria, and the product roadmap.

## Security test requirements

Before commercial approval, test authentication and authorization, session expiry, cookie attributes, TLS configuration, rate and resource exhaustion, upload handling, prompt injection, malicious documents, cross-assistant knowledge and tool isolation, launcher selection, direct-model policy, backup confidentiality, restore integrity, logging leakage, dependency vulnerabilities, Docker isolation, upgrade/rollback, and loss of upstream registry access.
