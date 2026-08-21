# Qwen3.5 9B promotion

## Decision

NetTAP Network Intelligence `0.4.0-rc.1` promotes the reviewed Qwen3.5 9B Q4_K_M candidate to the default base for both managed Open WebUI profiles and the shared technical model `nettap-ai:0.4.0-rc.1`.

The release uses the explicit Ollama tag `qwen3.5:9b-q4_K_M` and requires Ollama model ID `6488c96fa5fa`. The NetTAP tag is created from that verified base and `model/nettap-ai.Modelfile`; it is not a separately fine-tuned weight set.

## Product effect

- Network & Visibility and Packet Expert remain two lightweight profiles over one shared Ollama model.
- The Qwen3.5 9B base provides a larger, newer foundation and a 16,384-token configured context window.
- Existing NetTAP policy, specialist Skills, reviewed knowledge, offline RAG, profile isolation and evidence controls remain in force.
- Qwen3.5 multimodal and tool-oriented upstream capabilities do not automatically enable image ingestion, tool execution or external connectors in NetTAP.
- Raw PCAP, logs, flow records and telemetry still require an approved deterministic parser and validated schema. The LLM analyzes normalized evidence; it does not become a packet decoder merely because the base model changed.

## Version integrity

`nettap-ai:0.3.0-rc.4` remains the historical Qwen2.5-based artifact. It is not overwritten. Successful `0.4.0-rc.1` initialization verifies the new model and both profiles before recognized superseded NetTAP tags are retired from the active appliance store.

## Acceptance status

Promotion makes Qwen3.5 9B the repository default release candidate. It does not certify production accuracy or commercial readiness. The exact release commit must still pass clean macOS and Windows/WSL2 deployment, behavior, profile-isolation, offline RAG, storage, recovery, SBOM/CVE, security, legal and signed release-acceptance gates.

See the [model card](../model/MODEL_CARD.md), [validation status](VALIDATION_STATUS.md) and [0.4.0-rc.1 acceptance plan](0.4.0_RC1_ACCEPTANCE_PLAN.md).
