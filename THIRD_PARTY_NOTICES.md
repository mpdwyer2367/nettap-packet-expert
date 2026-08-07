# Third-party notices and distribution review

This repository orchestrates separately distributed components; it does not contain their container binaries or base-model weights.

| Component | Candidate reference | Upstream license/source | Distribution note |
|---|---|---|---|
| Ollama | `ollama/ollama:0.32.5` before digest lock | [Ollama repository](https://github.com/ollama/ollama) | MIT-licensed source; verify bundled notices and image contents |
| Qwen3.5 9B | `qwen3.5:9b-q4_K_M`, expected Ollama ID `6488c96fa5fa` | [Ollama model page](https://ollama.com/library/qwen3.5:9b-q4_K_M) | Multimodal Apache-2.0 model; initialization refuses a changed manifest identity |
| Open WebUI | `ghcr.io/open-webui/open-webui:v0.11.0` before digest lock | [Open WebUI license](https://github.com/open-webui/open-webui/blob/main/LICENSE) | Branding and redistribution terms require legal review; supplied config does not remove branding |
| all-MiniLM-L6-v2 embedding model | Revision `1110a243fdf4706b3f48f1d95db1a4f5529b4d41` | [Hugging Face model record](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) | Apache-2.0 model; cached during controlled initialization and loaded locally with remote code disabled |
| Caddy | `caddy:2.11.4-alpine` before digest lock | [Caddy official image](https://hub.docker.com/_/caddy) | Apache-2.0 core; container may include other licensed packages |
| Alpine Linux | `alpine:3.24.1` before digest lock and as image base | [Alpine official image](https://hub.docker.com/_/alpine) | Package-level notices must be retained as applicable |

NetTAP-authored source, configuration, and documentation are licensed under Apache License 2.0. That license does not relicense the components, images, packages, fonts, base model, or other artifacts listed above.

Before any commercial distribution, legal must approve:

1. exact image/model digests and complete SPDX SBOMs;
2. license texts, copyright notices, attribution, source-offer obligations, and export restrictions;
3. Open WebUI branding and commercial-use terms for the intended customer/user count;
4. NetTAP trademark and branding usage;
5. customer terms, privacy/data processing, support, warranty, and limitation language.

Bootstrap tags in `.env.example` are not production attestations. `scripts/lock-images.sh` records platform-resolved digests in ignored `.env`; `scripts/security-scan.sh` generates candidate SBOM/CVE evidence. Commercial approval must bind its legal record to the exact digests actually distributed.
