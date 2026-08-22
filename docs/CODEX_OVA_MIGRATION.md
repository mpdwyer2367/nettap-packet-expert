# Codex-managed OVA migration

## Decision

Codex becomes the controlled engineering environment for the existing NetTAP
repository. It reviews and changes source, runs deterministic tests, prepares
release evidence, and manages draft pull requests. Codex is not installed in
the customer appliance and is not needed for inference.

The appliance is Ubuntu Server 24.04 LTS with Docker Engine, Compose, TShark,
Open WebUI, Ollama, the NetTAP Evidence Workspace, a TLS gateway, and the
`nettapctl` administration CLI. The application remains local-first and retains
the current `nettap-ai:0.4.0-rc.1` model contract.

## Artifact matrix

| Artifact | Host class | Guest architecture | Status gate |
|---|---|---|---|
| `nettap-ai-0.4.0-rc.1-virtualbox-amd64.ova` | Intel/AMD Windows, Linux, Intel macOS | amd64 | VirtualBox import and runtime acceptance |
| `nettap-ai-0.4.0-rc.1-vmware-amd64.ova` | VMware Workstation/Fusion on Intel/AMD | amd64 | VMware import and runtime acceptance |
| `nettap-ai-0.4.0-rc.1-virtualbox-arm64.ova` | Apple Silicon/Windows Arm | arm64 | Native Arm build and VirtualBox import acceptance |
| `nettap-ai-0.4.0-rc.1-vmware-arm64.ova` | VMware Fusion on Apple Silicon | arm64 | Native Arm build and Fusion import acceptance |

An artifact is not released merely because its source validates. It must pass
the matching hypervisor workflow on matching hardware.

## Appliance profiles

### Evaluation

- 6 vCPU
- 12 GiB RAM
- 120 GiB dynamically allocated disk
- One concurrent inference request
- 4,096-token context
- Suitable for functional testing, not performance claims

### Production baseline

- 16 vCPU
- 64 GiB RAM
- 1 TiB storage
- Customer-approved retention, backup, TLS, DNS, and access policy

Virtualized Ollama inference is CPU-bound unless the selected hypervisor and
host provide a separately qualified accelerator-passthrough path. The release
must not promise native Metal or CUDA performance inside a generic OVA.

## Release bundle

Each downloadable bundle contains:

- architecture- and hypervisor-specific OVA;
- SHA-256 checksum;
- CycloneDX or SPDX SBOM;
- source commit and Git tree identity;
- build manifest and input checksums;
- signed provenance when an authorized signing key is supplied;
- import guide, first-boot guide, and acceptance report;
- no default production credential and no customer evidence.

## Acceptance gates

1. Source: syntax, unit, Compose rendering, Packer validation, secrets scan.
2. Build: pinned ISO verification, successful image build, OVA manifest.
3. Import: clean hypervisor import with expected CPU, RAM, disk, and NIC.
4. First boot: unique machine identity, random bootstrap secret, SSH and HTTPS.
5. Application: Open WebUI, Evidence Workspace, Ollama, gateway, launchers.
6. Evidence: PCAP and PCAPNG upload, TShark decode, no raw payload in context.
7. Model: `nettap-ai:0.4.0-rc.1` selected by both managed assistants and one
   bounded inference succeeds.
8. Persistence: reboot and service recovery without reprovisioning.
9. Offline: registry egress removed and the same evidence/model checks repeat.
10. Recovery: encrypted backup, clean restore, and evidence/chat continuity.

## Migration stages

1. Stabilize current application tests and managed attachment handling.
2. Add the appliance filesystem contract and `nettapctl`.
3. Add reproducible Packer builds for each supported architecture/hypervisor.
4. Add first-boot identity, TLS, secrets, systemd, firewall, and audit controls.
5. Add source and guest smoke tests.
6. Build candidates on native hypervisor workers.
7. Run full acceptance and publish only artifacts with complete evidence.
