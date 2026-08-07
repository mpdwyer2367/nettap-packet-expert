# NetTAP Network Intelligence model card

| Field | Value |
|---|---|
| Model tag | `nettap-ai:0.3.0-rc.8` |
| Base | `qwen3.5:9b-q4_K_M` |
| Expected Ollama base ID | `6488c96fa5fa` |
| Status | Release candidate; not production-certified |
| Copyright | Copyright 2026 NetTAP Technology Limited |

`nettap-ai` is one Ollama Modelfile-derived model for the combined NetTAP Network Observability & Packet Analysis assistant. It covers network architecture, visibility acquisition, telemetry, troubleshooting, packet-derived analysis, security operations and forensic guidance. It is not a separately fine-tuned weight set.

A clean deployment downloads the approved multimodal Qwen3.5 9B Q4_K_M base once. `ollama create` adds the NetTAP manifest while reusing content-addressed base blobs. The repository does not contain multi-gigabyte third-party weights. The pinned embedding model is a separate RAG dependency, not another chat LLM.

The full deployment adds reviewed prompts, one Skill, three managed knowledge collections and an attachment Filter. Packet, log and normalized flow attachments are deterministically processed by an internal evidence service; supported network images are signature-validated and processed by the local multimodal model. Credentials and TLS secrets are never requested.

## Native model-only installation

```bash
./scripts/install-model-native.sh --confirm-download
ollama run nettap-ai:0.3.0-rc.8
```

This does not install Open WebUI, RAG or attachment ingestion. Use the repository deployment guide for the complete application.

## Limitations

- No live data exists unless an approved connector supplies it.
- Classic PCAP support is limited to documented link types; PCAPNG and native binary flow formats require approved normalization.
- Encryption secrets must never be supplied to the LLM.
- Network changes and security conclusions require qualified human review.
- Findings are indicators or hypotheses unless sufficient evidence establishes a stronger conclusion.

Source tests do not constitute production certification. Exact-commit macOS and Windows/WSL2 runtime tests, attachments, restart, backup/restore/rollback, SBOM/CVE, penetration-test, signing, legal, support and commercial gates remain required.
