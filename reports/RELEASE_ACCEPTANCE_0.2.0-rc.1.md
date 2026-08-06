# Release acceptance record — NetTAP Packet Expert 0.2.0-rc.1

> Historical naming: this record covers the earlier standalone Packet Expert
> candidate. Packet Expert is now an experience within **NetTAP Network Intelligence**.

Record completed: 2026-08-05T04:42:05Z

Evidence cutoff: 2026-08-05T04:42:05Z

Record state: **COMPLETE AS A PRODUCTION-CANDIDATE EVIDENCE BASELINE**

Release disposition: **EVALUATION ONLY — CONTROLLED NON-PRODUCTION QUALIFICATION**

Production/customer deployment approval: **NOT GRANTED**

Commercial distribution approval: **NOT GRANTED**

This record contains no passwords, secrets, private keys, customer evidence, packet payloads, personal data, or vulnerability exploit details. `PASS (source)` means the identified source tree and automated policy checks passed. It does not imply that Docker runtime, model inference, a physical host, a browser workflow, or an independent control was tested.

## Release identity

| Field | Recorded value | Status |
|---|---|---|
| Product | NetTAP Packet Expert | Recorded |
| Version | `0.2.0-rc.1` | Recorded |
| Repository | `mpdwyer2367/nettap-packet-expert` | Public repository verified |
| Target branch | `main` | Verified |
| Accepted source commit | `bf5524fb79dce8c226a9668fab9903bfc3544d0f` | Verified on `main` |
| Accepted Git tree | `5ca3a596a435ad1f09c61bb8500280387e5c45ec` | Matches validated candidate source |
| Integration PR | [PR #4](https://github.com/mpdwyer2367/nettap-packet-expert/pull/4) | Merged |
| Source CI | [Validate source run 33](https://github.com/mpdwyer2367/nettap-packet-expert/actions/runs/30974464940) | PASS |
| Release tag | No release tag published for this exact candidate | PENDING |
| Signed package, checksum and provenance | Tooling implemented; no authorized package for the accepted commit is recorded | PENDING |
| Signature verification | Not performed; no authorized signed artifact is recorded | PENDING |
| Record preparer | Automated evidence collation and application-architecture review | Not an authorized release signature |
| QA testers | Not assigned in available evidence | PENDING |
| Authorized approver | Not assigned in available evidence | PENDING |

## Model, configuration and dependency identity

| Item | Recorded identity | Status |
|---|---|---|
| Custom model name | `nettap-packet-expert:0.2.0-rc.1` | Defined in source |
| Base model | `qwen2.5:7b-instruct-q4_K_M` | Defined in source |
| Expected base-model manifest ID | `845dbda0ea48` | Source gate implemented; runtime confirmation pending |
| Runtime custom-model ID | Not available without exact-host initialization | PENDING |
| Model policy SHA-256 | `6716921f60e2b84647d309fb05b8bf7e69938cf7839ae2172a861f12c9bd490c` | Recorded |
| Knowledge SHA-256 | `cff58adc5794c12a8ecfb9276d37ca70eecf67cec4470c7260d57d8b60575275` | Recorded |
| Base Compose SHA-256 | `d49097bb1d492546058de90655d0689cbc3a8fce9a2f1708ccf042a2e6669e12` | Recorded |
| Production Compose SHA-256 | `460f47382513ac4ee4f4d04da3b336ec2f44d13b662729253f3436155627aeff` | Recorded |

The committed image references are bootstrap tags: `ollama/ollama:0.32.5`, `ghcr.io/open-webui/open-webui:v0.11.0`, `caddy:2.11.4-alpine`, and `alpine:3.24.1`. Production startup requires platform-specific immutable digests created by `scripts/lock-images.sh`; no approved digest set or matching SBOM is present in the available evidence.

## Accepted product scope

The candidate scope is one customer-isolated, single-node Docker software appliance using Ollama, Open WebUI, the NetTAP model policy, and an optional customer-certificate TLS gateway. Local activation is loopback-only. The production profile exposes only the TLS gateway and keeps Open WebUI and Ollama on internal networks.

This repository is not an OVA/OVF/VMDK appliance and does not implement native packet capture, PCAP decoding, IPFIX, NetFlow, syslog, SNMPv3, gNMI, REST/webhook collection, NetTAP NPB control, licensing enforcement, HA, SSO/MFA, or a centralized immutable audit service.

## Advertised-platform qualification

| Platform/architecture | Minimum allocation | Runtime evidence | Result |
|---|---|---|---|
| macOS Apple silicon with Docker Desktop | 8 CPUs, 16 GiB Docker memory, 40 GiB free disk | No exact-commit clean-host report recorded | PENDING |
| macOS Intel | Not approved as an advertised RC1 configuration | No report recorded | NOT IN ACCEPTED SCOPE |
| Windows with WSL 2 and Docker Desktop Linux containers | 8 CPUs, 16 GiB Docker memory, 40 GiB free disk | No exact-commit clean-host report recorded | PENDING |
| Linux server | Not approved as an advertised RC1 customer platform | No report recorded | NOT IN ACCEPTED SCOPE |

## Automated evidence

| Control | Evidence | Result |
|---|---|---|
| Shell syntax and lint | ShellCheck and Bash parsing in source workflow | PASS (source) |
| PowerShell deployment parsing | GitHub Actions PowerShell parser | PASS (source) |
| Secret/default-credential policy | Static checks reject committed shared administrator credentials and common secret patterns | PASS (source) |
| Documentation links and required files | `tests/static-checks.sh` | PASS (source) |
| Local Compose rendering | `compose.yaml` plus `compose.local.yaml` | PASS (source) |
| Production Compose rendering | `compose.yaml` plus `compose.production.yaml` | PASS (source) |
| Temporary-bootstrap Compose rendering | Production plus bootstrap profile with `initialize` enabled | PASS (source) |
| Unique administrator bootstrap | Generated credential and explicit retirement controls present | PASS (source); runtime pending |
| Production gateway refusal before activation | Fail-closed startup logic present | PASS (source); runtime pending |
| TLS, secure cookies and HSTS | Configuration and runtime verifier present | PASS (source); runtime pending |
| No direct Ollama/Open WebUI production ports | Production policy and verifier present | PASS (source); runtime pending |
| Running image digest and least-privilege controls | Runtime verifier present | PASS (source); exact-host result pending |
| Temporary registry egress removed | Bootstrap/runtime separation and verifier present | PASS (source); exact-host result pending |
| Base/custom model identity | Expected base ID and model-lock comparison implemented | PASS (source); exact-host result pending |
| Six behavioral guardrails | Test harness present | IMPLEMENTED; inference results pending |
| SPDX SBOM and HIGH/CRITICAL CVE policy | Scan command and matching-image gate present | IMPLEMENTED; release scan pending |
| Backup provenance and checksum | Backup manifest records release, images, source and model identity | PASS (source); recovery exercise pending |
| Non-overwriting same-release restore | Restore validates checksums, format, source and release before creating new volumes | PASS (source); recovery exercise pending |
| Signed package provenance | Artifact digest, version, commit and tree signing logic present | PASS (source); authorized signing pending |
| Tampered provenance rejection | Negative local validation recorded in PR #4 | PASS (development evidence) |
| Resource and concurrency behavior | No exact-host performance report recorded | PENDING |

## Manual acceptance

| Test | Result |
|---|---|
| Generated first login succeeds | PENDING |
| Bootstrap password is replaced and subsequently rejected | PENDING |
| New password persists through restart | PENDING |
| Signup and disabled high-risk features remain unavailable | PENDING |
| Packet Expert model appears and answers the four broad starter prompts | PENDING |
| Approved knowledge revision imports, attaches and retrieves correctly | PENDING |
| Prompt-injection and evidence-boundary behavior passes on the running model | PENDING |
| Customer DNS, certificate chain, SAN and browser TLS behavior pass | PENDING |
| Gateway, application and audit logging meet retention requirements | PENDING |
| Support handoff and operator runbook exercise pass | PENDING |

## Independent and organizational gates

| Gate | Required owner | Result |
|---|---|---|
| Exact-digest SBOM/CVE acceptance and documented exceptions | Security | PENDING |
| Independent penetration test and remediation verification | Security/independent assessor | PENDING |
| Privacy, retention and customer data-processing review | Legal/Security | PENDING |
| Third-party licensing, Open WebUI commercial use and branding review | Legal | PENDING |
| Encrypted backup and disaster-recovery exercise with measured RPO/RTO | Operations | PENDING |
| Supported-host matrix, SLA, escalation, vulnerability response and EOL policy | Support/Product | PENDING |
| Authorized Cosign release signature and public-key publication | Release manager | PENDING |
| Signed acceptance tied to commit, artifacts, digests, hosts and exceptions | Authorized approver | PENDING |

## Decision

- [x] Evaluation only — controlled non-production qualification
- [ ] Customer deployment accepted for a named customer and environment
- [ ] Commercial distribution approved for the defined scope
- [ ] Production certified
- [ ] Rejected

Candidate architecture decision: **PASS for controlled qualification.**

Production readiness decision: **NOT APPROVED.**

Commercial release decision: **NOT APPROVED.**

Validity: This record applies only to commit `bf5524fb79dce8c226a9668fab9903bfc3544d0f` and Git tree `5ca3a596a435ad1f09c61bb8500280387e5c45ec`. Any source, dependency, model-policy, knowledge, image-digest, or supported-platform change requires impact review and updated evidence.

Approver signature: **PENDING — no authorized signature was supplied.**

## Required path to release approval

1. Package the exact accepted commit, publish its tag, checksum, provenance and authorized Cosign signatures.
2. Lock platform-specific image digests and generate matching SPDX SBOM/CVE evidence.
3. Pass clean-host macOS Apple-silicon and Windows/WSL2 deployment records.
4. Pass browser, administrator lifecycle, persistence, knowledge and TLS acceptance.
5. Pass the running six-case guardrail suite and an approved domain-accuracy/safety evaluation set.
6. Complete performance, concurrency, resource-exhaustion and recovery exercises.
7. Complete penetration, privacy, licensing, branding, support and EOL approvals.
8. Have the authorized release owner review protected evidence and sign the final acceptance.

Until all eight steps pass, the accurate claim is: “NetTAP Packet Expert 0.2.0-rc.1 is a valid production candidate for controlled, non-production qualification of the defined single-node, single-customer Docker architecture.”
