# NetTAP Network Observability & Packet Analysis 0.3.0-rc.8 acceptance plan

RC8 is the consolidated multimodal candidate. It is eligible for controlled evaluation only until every target-host, security, signing and commercial gate below is complete.

## Candidate identity

- Release: `0.3.0-rc.8`
- Application: one authenticated Open WebUI at local loopback port 3100
- Managed assistant: `nettap-network-operations`
- NetTAP model: `nettap-ai:0.3.0-rc.8`
- Base model: `qwen3.5:9b-q4_K_M`, expected Ollama ID `6488c96fa5fa`
- Embedding revision: `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`
- Retired local ports: 3000, 3001 and 3200

## Source and configuration gates

1. Static checks, Python unit tests, parser tests, provisioning API-contract tests and production-configuration checks pass.
2. The local Compose result publishes only `127.0.0.1:3100`; Ollama and the evidence service publish no host ports.
3. Provisioning creates exactly one managed assistant with three managed knowledge collections, one Skill, one attachment Filter and no user-selectable evidence tool server.
4. The assistant is pinned as the default, has vision enabled and uses only `nettap-ai:0.3.0-rc.8`.
5. Supported file types fail closed on extension/signature mismatch, size violations and unsupported formats.

## Clean macOS and Windows/WSL2 acceptance

Use the same signed source package, Git tree, model identity and knowledge fingerprint on both platforms.

1. Start from empty NetTAP volumes with the one-command platform installer.
2. Confirm a unique local bootstrap credential, immediate password change and bootstrap retirement.
3. Confirm `http://127.0.0.1:3100/health` and browser login; confirm ports 3000, 3001 and 3200 refuse connections.
4. Confirm Ollama and the evidence service have no host bindings.
5. Confirm one current NetTAP tag and exact base-model ID.
6. Confirm offline RAG after installation-time egress is removed.
7. Attach representative classic PCAP, log, JSON/JSONL normalized flow and PNG/JPEG/WebP network-diagram fixtures.
8. Confirm evidence citations and quality warnings; confirm image output separates visible facts from inference.
9. Execute all behavioral tests, including unavailable-live-data, visual prompt injection and unsupported attachment cases.
10. Test restart, backup, non-overwriting restore and failed-update rollback.

## Release evidence

- Source package and image checksums
- SBOM and vulnerability-policy result
- Signed artifacts and signature-verification record
- macOS and Windows/WSL2 acceptance reports for the exact package
- Penetration-test disposition
- Legal, support and commercial approvals
- Completed release-acceptance record

Absence of any required record keeps production and commercial certification blocked.
