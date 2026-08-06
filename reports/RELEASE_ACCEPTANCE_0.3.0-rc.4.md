# Release acceptance record — NetTAP Network Intelligence 0.3.0-rc.4

Recorded date: 2026-08-05

Record type: one-model replacement and canonical-naming baseline

Release disposition: **EVALUATION ONLY**

Production/customer deployment approval: **NOT GRANTED**

Commercial distribution approval: **NOT GRANTED**

## Candidate identity

| Field | Recorded value |
|---|---|
| Version | `0.3.0-rc.4` |
| Combined model | `nettap-ai:0.3.0-rc.4` |
| Shared base | `qwen2.5:7b-instruct-q4_K_M` |
| Expected base ID | `845dbda0ea48` |
| Open WebUI profiles | `nettap-network-visibility`, `nettap-packet-expert` |
| Source commit and tree | Pending final candidate commit |
| Signed package and SHA-256 | Pending authorized release build |

## Gate status

| Gate | Status |
|---|---|
| One combined model source and canonical identity | Implemented; source validation required |
| Automatic one-model retirement safeguards | Implemented; target-host runtime acceptance required |
| Open WebUI names, prompts, Skills, knowledge, and profile bindings | Implemented; browser/runtime acceptance required |
| Application and model-lifecycle architecture documentation | Implemented; architecture review required |
| macOS clean-package acceptance | Pending |
| Windows/WSL2 clean-package acceptance | Pending |
| SBOM/CVE and penetration-test disposition | Pending |
| Legal, support, commercial, signing, and authorized acceptance | Pending |

## Decision

RC4 may enter controlled qualification after source CI passes. This record does
not authorize production, customer, or commercial deployment.
