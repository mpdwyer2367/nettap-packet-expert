# NetTAP engineering contract

## Product boundary

Codex is the development and release agent. It is not part of the deployed
runtime. The appliance must operate without an OpenAI API key and, after
initialization, without Internet access.

## Required acceptance path

Every appliance change must preserve this operator journey:

1. Import the architecture-matched OVA.
2. Connect by console or SSH and run `sudo nettapctl setup`.
3. Open the private HTTPS application.
4. Create an authorized investigation and upload a PCAP or PCAPNG.
5. Decode locally with TShark and retain only minimized packet metadata in the
   model context.
6. Produce a cited answer and deterministic evidence report.
7. Reboot, verify persistence, disconnect registry egress, and repeat health
   and inference checks.
8. Prove backup and restore.

## Engineering rules

- Never claim an OVA or hypervisor passed unless the corresponding import,
  boot, SSH, application, inference, reboot, and persistence evidence exists.
- Report gates as `PASS`, `FAIL`, `BLOCKED`, or `NOT EXECUTED`.
- Never include reusable credentials, private keys, customer captures, model
  weights, or evidence tokens in Git.
- Pin source ISOs and release inputs by SHA-256.
- Build `amd64` and `arm64` artifacts separately. Never relabel one
  architecture as the other.
- Raw packet payloads must not enter prompts, logs, reports, or RAG.
- Preserve named Docker volumes during upgrades and ordinary shutdowns.
- Do not use `docker compose down -v` in appliance lifecycle code.

## Verification

Run the source gate before committing appliance changes:

```bash
python3 -m unittest -v appliance/tests/test_appliance_sources.py
python3 -m unittest -v tests/test_case_service.py tests/test_evidence_filter.py tests/test_packet_decoder.py
./appliance/tests/source-gate.sh
```

