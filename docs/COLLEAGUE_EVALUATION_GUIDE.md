# Colleague evaluation guide

This is the shortest controlled macOS evaluation path for NetTAP AI Suite `0.3.0-rc.1`. It does not grant production or commercial approval.

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
4. Switch between both assistants in the model selector.
5. Confirm neither assistant claims that live traffic, telemetry, or a capture is available.
6. Confirm Network & Visibility requests device identity before exact configuration.
7. Confirm explicit PCAP work routes to Packet Expert.
8. Import each knowledge file into a separate restricted collection and attach it only to its matching Workspace Model.
9. Confirm one assistant does not retrieve the other's specialist knowledge during a negative test.
10. Restart and confirm accounts, chats, knowledge, and both models persist.

## Record

Save the generated macOS reports, host and Docker versions, image digests, model IDs, storage before and after both manifests, browser results, knowledge hashes, backup/restore result, exceptions, and tester identity. Use the release acceptance template and do not describe a source-only pass as a production certification.

Existing Packet Expert 0.2 deployments must use [MIGRATION.md](MIGRATION.md), not the fresh-install procedure.
