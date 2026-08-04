# Third-party notices and release constraints

This repository orchestrates separately distributed components; it does not contain their model weights or container binaries.

- Ollama is distributed under the MIT License. The deployment pulls its container image from `ollama/ollama`.
- Qwen2.5-7B-Instruct is distributed under Apache License 2.0. Ollama downloads the selected quantization during model creation.
- Open WebUI is distributed under the Open WebUI License. Its current license restricts removal or replacement of Open WebUI branding except for specified small deployments, written permission, or an enterprise license. This project intentionally does not remove Open WebUI branding.

Container tags in `.env.example` are release-candidate pins, not a supply-chain attestation. A production release must record immutable digests, generate an SBOM, scan images and source, and retain the reports with the release.

No license is granted here for NetTAP names, logos, or trademarks. The repository owner must select and add a license for NetTAP-authored source before representing the project as open source.
