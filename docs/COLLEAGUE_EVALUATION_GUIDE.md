# Colleague evaluation guide

This is the shortest controlled macOS evaluation path for NetTAP AI Suite `0.3.0-rc.2`. It does not grant production or commercial approval.

## Fresh evaluation

```bash
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
cd nettap-packet-expert
chmod +x scripts/* tests/*.sh
./tests/static-checks.sh
./scripts/start-macos.sh
./tests/macos-e2e.sh
```

## Browser checks

1. Open <http://127.0.0.1:3000>; confirm the Network & Visibility page and its three broad starting points.
2. Open <http://127.0.0.1:3001>; confirm the Packet Expert page and its three investigation starting points.
3. Sign in once and confirm both use the same Open WebUI account and history.
4. Confirm `nettap-ai:0.3.0-rc.2` is the single selected NetTAP runtime model; then test both Workspace Model profiles if they were imported.
5. Confirm neither profile claims that live traffic, telemetry, or a capture is available.
6. Confirm Network & Visibility requests device identity before exact configuration.
7. Confirm an explicit Packet Expert mode request produces an evidence-first PCAP workflow from the same model.
8. Import the shared knowledge file plus each specialist file into separate restricted collections. Attach shared knowledge to both Workspace Models and only the matching specialist collection to each profile.
9. Confirm one profile does not retrieve the other's specialist knowledge during a negative test.
10. Restart and confirm accounts, chats, knowledge, profiles, and the combined model persist.

## Record

Save the generated macOS reports, host and Docker versions, image digests, base and combined model IDs, model-store measurement, browser results, knowledge hashes, backup/restore result, exceptions, and tester identity. Use the release acceptance template and do not describe a source-only pass as a production certification.

Existing Packet Expert 0.2 deployments must use [MIGRATION.md](MIGRATION.md), not the fresh-install procedure.
