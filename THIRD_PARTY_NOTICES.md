# Third-party notices and release constraints

This repository orchestrates separately distributed components; it does not contain their model weights or container binaries.

- Ollama is distributed under the MIT License. The deployment pulls its container image from `ollama/ollama`.
- Qwen2.5-7B-Instruct is distributed under Apache License 2.0. Ollama downloads the selected quantization during model creation.
- Open WebUI is distributed under the Open WebUI License. Its current license restricts removal or replacement of Open WebUI branding except for specified small deployments, written permission, or an enterprise license. This project intentionally does not remove Open WebUI branding.

Container tags in `.env.example` are release-candidate pins, not a supply-chain attestation. A production release must record immutable digests, generate an SBOM, scan images and source, and retain the reports with the release.

NetTAP-authored source code, configuration, and documentation in this repository are licensed under Apache License 2.0. This does not relicense the separately distributed components listed above, their container images, or their model artifacts.

No permission is granted to use NetTAP names, logos, service marks, or product names except as stated in Section 6 of the Apache License 2.0.
