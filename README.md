# NetTAP Packet Expert

NetTAP Packet Expert is a local packet-analysis operations engineering and security operations assistant. It combines a Qwen2.5 7B instruction model, an evidence-disciplined NetTAP system prompt, Ollama, and Open WebUI in a repeatable macOS Docker deployment.

This release is a custom Ollama model definition and deployment, not a set of fine-tuned weights. The Qwen base model is downloaded from the Ollama registry at deployment time; the NetTAP behavior is supplied by the versioned `Modelfile` and knowledge guidance in this repository.

## What it does

- Guides authorized network-performance and security investigations.
- Helps plan narrow, privacy-aware packet acquisition.
- Interprets normalized packet-derived facts while separating observations from hypotheses.
- Helps validate visibility coverage and evidence quality.
- Provides broad starter prompts for users who do not know where to begin.

## What it does not do

This project does not capture interfaces, decode binary PCAP by itself, observe live traffic, replace Wireshark/TShark, or autonomously operate network or security controls. A NetTAP TAP/NPB or another authorized source must deliver evidence to an approved capture and normalization pipeline. Only normalized, minimized evidence should cross into the language-model boundary.

## Architecture

1. Docker Desktop runs an internal Ollama service and a loopback-only Open WebUI service.
2. Ollama explicitly downloads `qwen2.5:7b-instruct-q4_K_M` and creates `nettap-packet-expert:0.1.0-rc.7` from `model/Modelfile`.
3. Open WebUI connects to Ollama only over an internal Docker network.
4. The user signs in at `http://127.0.0.1:3001` and selects Packet Expert.
5. Packet evidence, when authorized, must first be collected and normalized by external tooling. The assistant receives only supplied evidence and cannot claim live visibility.

## Quick start on macOS

Prerequisites: Docker Desktop running, 16 GB host memory recommended, and at least 15 GB free disk.

```bash
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
cd nettap-packet-expert
./scripts/start-macos.sh
```

Open `http://127.0.0.1:3001`. The first account becomes the administrator. Keep the loopback binding until an approved TLS and access-control design is deployed.

Run the release-candidate acceptance harness on the Mac:

```bash
./tests/macos-e2e.sh
```

See [macOS deployment and acceptance](docs/MACOS_DEPLOYMENT.md), [security and evidence boundary](docs/SECURITY.md), and [third-party notices](THIRD_PARTY_NOTICES.md).

## Release status

`0.1.0-rc.7` is an evaluation release candidate. It has source-level validation in CI but must not be called macOS-validated until `tests/macos-e2e.sh` and the manual acceptance checklist pass on a physical Apple silicon Mac and an Intel Mac if Intel support will be advertised.

The default all-container Apple silicon path is CPU-compatible. Docker Desktop does not expose Apple Metal acceleration to the Linux Ollama container. Do not claim GPU acceleration for this profile.

## Licensing

No license has yet been selected for NetTAP-authored source. Public visibility is not the same as an open-source license. Review `THIRD_PARTY_NOTICES.md` and add an approved project license before inviting redistribution or external contributions.
