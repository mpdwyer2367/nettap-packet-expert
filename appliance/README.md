# NetTAP virtual appliance

This directory turns the NetTAP Docker application into architecture-specific
Ubuntu 24.04 virtual appliances. Codex develops, reviews, tests and packages the
release; it is not a runtime dependency and no OpenAI credential is installed.

## Artifact policy

Build AMD64 on an AMD64 host and ARM64 on an ARM64 host. VirtualBox on Apple
Silicon cannot run an AMD64 guest. Never relabel an emulated build as a native
release. The VirtualBox artifact is emitted directly as OVA. The VMware VM is
exported with VMware OVF Tool during packaging.

Evaluation defaults are 6 vCPU, 12 GiB RAM and 120 GiB disk. The production
baseline remains 16 vCPU, 64 GiB RAM and 1 TiB disk. CPU-only evaluation is
functional but not a throughput benchmark.

## Build

```bash
./scripts/build-appliance.sh --hypervisor virtualbox --arch arm64
./scripts/build-appliance.sh --hypervisor vmware --arch arm64
./scripts/package-appliance-bundle.sh --arch arm64 --hypervisor virtualbox
./scripts/package-appliance-bundle.sh --arch arm64 --hypervisor vmware
```

The build scripts reject a target architecture that does not match the host.

## First boot

The VM console displays a one-time OS password. SSH as `nettap`, change that
password when prompted, then configure the application:

```bash
sudo nettapctl setup --hostname nettap-ai.local --admin-email admin@example.com
sudo nettapctl health
sudo nettapctl acceptance
```

The application is exposed only at `https://<hostname>:8443`. The setup command
prints the root-only path containing the one-time application bootstrap
credential. Change it in Open WebUI and run `sudo nettapctl finalize-admin`.

## Release proof

`appliance/tests/source-gate.sh` validates source contracts. `nettapctl
acceptance` runs inside the imported guest and produces machine-readable and
human-readable evidence under `/var/lib/nettap/acceptance`. A release is not
functional until native-host import, boot, setup, upload/decode, inference,
backup/restore and reboot gates are all PASS. Missing hypervisors are reported
as `NOT EXECUTED`, never PASS.
