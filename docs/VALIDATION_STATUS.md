# Validation status — 0.3.0-rc.8

| Area | Status |
|---|---|
| Python parser/provisioner unit tests | Source-tested |
| Static repository and Compose policy | Source-tested |
| Combined assistant/Skill/Filter pins | Source-tested; checksum verification passed |
| One UI and internal-only service configuration | Source-tested |
| PCAP/log/flow parsing and network-image validation | 27 Python tests passed locally |
| Loopback policy | Static pass: only 3100 published; runtime verifier now rejects listeners on 3000/3001/3200 |
| Clean macOS Docker runtime | Required on exact release commit/package |
| Clean Windows/WSL2 runtime | Required on same commit/package |
| Browser login/password activation | Required |
| Representative PCAP/log/normalized-flow/network-image chat ingestion | Required |
| Restart, backup, restore and rollback | Required |
| SBOM, CVE disposition and penetration-test disposition | Required |
| Signed packages and checksum verification | Required |
| Legal, support and commercial approval | Required |

RC8 is a release candidate, not a production certification. A report is valid only for its recorded commit, tree, package checksum, image digests, model IDs and platform.
