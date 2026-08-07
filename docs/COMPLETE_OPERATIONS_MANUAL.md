# Complete operations manual

NetTAP Network Intelligence delivers one customer application: NetTAP Network Observability & Packet Analysis. It runs at port 3100 locally and combines network design, visibility, troubleshooting, packet analysis and security/forensic workflows in one authenticated assistant.

## Operator sequence

1. Start with the platform command in the macOS or Windows guide.
2. Complete the generated administrator-password activation.
3. Confirm `./scripts/nettap-ai health` and the platform verifier pass.
4. Use chat for objectives and supported evidence attachments.
5. Back up before every update; preserve reports and audit records.
6. Apply only an approved release commit/package and test rollback.

All supported lifecycle commands, logs, data locations, authentication recovery, backup/restore, GitHub maintenance and release evidence are in the [Administrator guide](ADMINISTRATION.md). Architecture and evidence limitations are in [Application architecture](ARCHITECTURE.md) and [Integrated evidence ingestion](EVIDENCE_CASE_SERVICE.md). Platform steps are in [macOS deployment](MACOS_DEPLOYMENT.md) and [Windows/WSL2 deployment](WINDOWS_DEPLOYMENT.md).

The retired ports 3000, 3001 and 3200 are not part of RC7. Do not restart `assistant-launcher`, expose the evidence service or create separate model downloads.
