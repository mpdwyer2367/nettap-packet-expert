# Commercial release gates

Commercial distribution is fail-closed. Passing source CI is necessary but insufficient.

| Gate | Required evidence | Owner | Candidate status |
|---|---|---|---|
| Source integrity | Shell lint, policy/secret checks, Compose rendering, exact commit | Engineering | Automated |
| Functional runtime | Fresh-install reports on advertised macOS and Windows configurations | QA | Pending physical hosts |
| Model behavior | Ten guardrail/routing cases plus representative domain evals for both assistants | AI/QA | Smoke suite implemented; expanded eval pending |
| Assistant isolation | Prompt, knowledge, RBAC, tool, launcher and direct-model negative tests | AI/Security | Source controls implemented; runtime evidence pending |
| Storage reuse | Before/after model-store measurement proving one approved base and two manifests | QA | Pending target hosts |
| Supply chain | Immutable digests, SPDX SBOM, no unapproved HIGH/CRITICAL findings | Security | Tooling implemented; release scan pending |
| Penetration test | Independent report and approved remediation/exception record | Security | Pending |
| Data protection | Customer DPA/privacy/retention and evidence-handling review | Legal/Security | Pending |
| Third-party rights | Open WebUI, Ollama, Qwen, Caddy, Alpine and branding review | Legal | Pending approval |
| Recovery | Encrypted backup plus test restore and measured recovery time | Operations | Tooling implemented; host evidence pending |
| Support | SLA, escalation, supported-host matrix, update and EOL policy | Support/Product | Pending |
| Release signing | Cosign signatures for artifact and provenance, public-key publication, checksum verification | Release manager | Tooling implemented; signatures pending |
| Acceptance | Signed release record tied to commit, digests, hosts and exceptions | Authorized approver | Pending |

## Automated refusal

`scripts/certify-production.sh` runs source checks and then requires non-empty private evidence records for both platform runtimes, vulnerability acceptance, penetration test, legal, support, and signed acceptance. It deliberately returns a nonzero result while evidence is absent.

Evidence filenames under ignored `reports/production/private/`:

- `runtime-macos.txt`
- `runtime-windows.txt`
- `vulnerability-scan-attestation.txt`
- `penetration-test-approval.txt`
- `legal-release-approval.txt`
- `support-readiness-approval.txt`
- `signed-acceptance.txt`

Presence alone is not a substitute for review. Each text record must include exact lines `Version: 0.3.0-rc.1`, `Commit: <full-commit>` and `Result: PASS` plus signer, date, scope, exceptions, and linked protected evidence. `signed-acceptance.txt` must also contain `Signature verification: PASS`. The script validates these markers; authorized people validate their truth and attachments.

## Certification vocabulary

- **Valid production candidate:** source and architecture may enter controlled non-production runtime/security qualification; this is not a deployment approval.
- **Source validated:** automated source checks passed.
- **Runtime verified:** the exact build passed on one named host.
- **Customer accepted:** one customer deployment passed its signed acceptance.
- **Commercially approved:** authorized business, security, legal, support, and release owners approved a signed artifact.
- **Production certified:** use only when the defined certification scope, evidence, validity period, and exceptions are published internally and approved.

Never use “100 percent secure,” “guaranteed accurate,” “fully autonomous,” or “certified” without the specific scope and current evidence.
