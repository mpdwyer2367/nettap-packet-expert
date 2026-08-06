# Production certification status — 0.2.0-rc.1

> Historical naming: this record covers the earlier standalone Packet Expert
> candidate. Packet Expert is now an experience within **NetTAP Network Intelligence**.

Assessment date: 2026-08-04  
Assessor role: application architecture and source-control review  
Candidate decision: **VALID PRODUCTION CANDIDATE for controlled runtime qualification**
Production certification decision: **NOT GRANTED — external evidence and approvals remain open**

“Valid production candidate” means the source has a coherent supported scope, automated policy checks, immutable release identity, fail-closed deployment controls, testable acceptance criteria, and no known code-level blocker to entering controlled runtime/security qualification. It does not authorize customer production use or commercial distribution.

## Architectural disposition

The coherent deployable scope is a single-node, single-customer Docker software appliance. Local evaluation remains loopback-only. Production traffic enters through a customer-certificate TLS gateway; Open WebUI and Ollama remain internal. Model/image initialization uses temporary registry egress that is removed before runtime.

This design is feasible for a small customer deployment when the release gates pass. It is not a high-availability appliance, shared multi-tenant service, native packet/telemetry collector, OVA, autonomous control system, or enterprise identity platform.

## Source controls integrated

| Control | Source status |
|---|---|
| Unique generated bootstrap and explicit retirement | Implemented |
| Production gateway blocked before activation | Implemented |
| TLS gateway and secure production cookies | Implemented |
| Direct WebUI/Ollama production ports absent | Implemented |
| Runtime networks internal; model registry egress temporary | Implemented |
| Exact container digest requirement | Implemented |
| Qwen manifest identity check | Implemented |
| Offline WebUI, disabled risky features and authoritative config | Implemented |
| Metadata audit log, resource/PID limits and log rotation | Implemented |
| SPDX image SBOM and HIGH/CRITICAL CVE gate | Implemented |
| Consistent stop/archive/restart backup | Implemented |
| Checksum validation and non-overwriting restore | Implemented |
| TLS, host sizing and runtime verification gates | Implemented |
| Runtime image/model identity and least-privilege verification | Implemented |
| Backup release/model/image provenance and same-release restore gate | Implemented |
| Signed package/checksum/provenance verification | Implemented |
| Prompt-injection, human-approval and evidence guardrails | Implemented |
| Fail-closed external certification evidence command | Implemented |
| Shell lint, policy checks and real Compose-profile rendering in CI | Implemented |

## Evidence still required

- passing physical-host macOS and Windows runs for every advertised configuration;
- browser, authentication, persistence, knowledge and customer TLS acceptance;
- representative performance/concurrency and resource-exhaustion tests;
- expanded domain accuracy, safety and multilingual evaluations with approved thresholds;
- exact-digest SBOM/CVE evidence and approved exceptions;
- independent penetration test and remediation verification;
- backup encryption and disaster-recovery exercise with measured RPO/RTO;
- legal approval for all third-party licenses, Open WebUI branding/commercial terms, privacy and contracts;
- licensing/entitlement design if sold as licensed software;
- support matrix, SLA, escalation, vulnerability response, update and EOL policy;
- authorized release signature and signed acceptance.

## Explicit exclusions

Native IPFIX, NetFlow, syslog, SNMPv3, gNMI, REST/webhook collectors, PCAP decoding, WinPcap/Npcap capture, NetTAP NPB control, centralized immutable audit export, SSO/MFA, HA, dashboard widgets, signed OS updates, OVA/OVF/VMDK packaging, licensing enforcement, and virtual-hardware validation are not implemented by this repository. They must not appear in customer claims for this candidate.

## Claims authorized today

“NetTAP Packet Expert 0.2.0-rc.1 is a valid production candidate for controlled, non-production qualification of the defined single-node, single-customer Docker architecture.”

“The candidate has automated source and Compose validation plus fail-closed runtime, supply-chain, recovery and commercial-release gates.”

Do not use “production ready,” “production certified,” “commercially approved,” “fully validated,” “100 percent accurate,” or “100 percent secure” until the exact-scope evidence and approvals in `docs/COMMERCIAL_RELEASE_GATES.md` are complete.

## Verification basis

Source checks: `tests/static-checks.sh`  
Compose-profile validation: `.github/workflows/validate.yml`
Runtime checks: `scripts/verify-production-deployment.sh`  
Certification refusal gate: `scripts/certify-production.sh`  
Acceptance record: `reports/RELEASE_ACCEPTANCE_TEMPLATE.md`
