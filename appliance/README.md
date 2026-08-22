# NetTAP appliance layer

This directory turns the existing application release into a sealed Ubuntu
Server 24.04 LTS appliance. It does not install Codex in the guest and does not
change the `nettap-ai:0.4.0-rc.1` inference contract.

## Filesystem contract

| Path | Contract |
|---|---|
| `/opt/nettap/releases/<version>` | Immutable application release tree |
| `/opt/nettap/current` | Symlink to the active release |
| `/etc/nettap/nettap.env` | Mode-0600 deployment configuration and secrets |
| `/etc/nettap/tls` | Bootstrap or customer-approved TLS certificate and key |
| `/etc/nettap/build-manifest.json` | Source, ISO, snapshot, architecture, and build identity |
| `/etc/nettap/sbom.cdx.json` | CycloneDX guest-package and container inventory |
| `/var/lib/nettap/ollama` | Ollama model state |
| `/var/lib/nettap/open-webui` | Open WebUI accounts, chats, knowledge, and audit log |
| `/var/lib/nettap/evidence` | Evidence database and retained local evidence |
| `/var/lib/nettap/state` | First-boot, bootstrap, and runtime state |
| `/var/lib/nettap/backups` | Encrypted appliance backups |
| `/var/lib/nettap/reports` | Guest acceptance and generated operational evidence |
| `/var/log/nettap` | Appliance-specific logs outside container logs |

Docker named volumes are bound to the `/var/lib/nettap` paths by
`compose.appliance.yaml`; this retains compatibility with the existing backup
scripts while making persistence explicit.

## Lifecycle

Packer verifies a pinned Ubuntu ISO, resolves packages from a pinned Ubuntu
archive snapshot, installs Docker/Compose/TShark, preloads immutable container
digests and the model, and then removes build identity. On first boot, systemd
creates a new machine ID, SSH host keys, TLS private key, OS password, Open
WebUI password, and evidence API token before starting the application.

`nettapctl` is the only appliance administration entry point. Run
`sudo nettapctl help` inside the guest.

Build, import, first-boot, and acceptance procedures live in the corresponding
documents under `docs/`. An OVA remains an unreleasable candidate until the
matching hypervisor workflow passes on matching native hardware.
