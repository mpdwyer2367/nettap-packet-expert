# Independent colleague evaluation

This is the shortest macOS evaluation path for `0.3.0-rc.1`. It does not grant production or commercial approval.

## Clean-room run

1. Use a test host with Docker Desktop, at least 16 GiB RAM, and 15 GiB free disk.
2. Clone a fresh copy and record the commit:

```bash
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
cd nettap-packet-expert
git rev-parse HEAD
chmod +x scripts/* tests/*.sh
./tests/colleague-macos-acceptance.sh
```

3. Open the loopback URL printed by the script.
4. Use the generated bootstrap credential file; do not put its contents in the report.
5. Replace the password, prove the generated value fails, and finalize the administrator.
6. Run `./scripts/install-openwebui-bundle.sh`, then confirm the six packet-specialist prompts, selected `nettap-packet-expert:latest` model, Packet Expert skill, non-live evidence boundary, and a successful chat.
7. Import and attach the approved knowledge file, record its hash, and test retrieval.
8. Run the six behavioral guardrail cases.

## Required report

Return the exact commit, macOS/architecture, Docker Desktop/Engine/Compose, allocated CPU/memory, image digests, model identity, timestamped automated reports, completed release-acceptance template, and all exceptions. Do not include passwords, private environment values, chat evidence, packet data, or customer identifiers.

Packet Expert does not capture traffic, decode arbitrary PCAP, ingest IPFIX, or connect to an NPB in this repository. The model is Qwen3 8B plus a NetTAP Modelfile, not separately fine-tuned weights.
