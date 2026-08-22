# OVA build guide

## Supported artifacts

| Target | Required native worker | Output |
|---|---|---|
| `virtualbox-amd64` | x86_64 host with VirtualBox | `nettap-ai-0.4.0-rc.1-virtualbox-amd64.ova` |
| `vmware-amd64` | x86_64 host with Workstation/Fusion and OVF Tool | `nettap-ai-0.4.0-rc.1-vmware-amd64.ova` |
| `virtualbox-arm64` | Arm64 host with Arm-capable VirtualBox | `nettap-ai-0.4.0-rc.1-virtualbox-arm64.ova` |
| `vmware-arm64` | Apple Silicon with Fusion and OVF Tool | `nettap-ai-0.4.0-rc.1-vmware-arm64.ova` |

Cross-architecture builds are rejected. The evaluation image is 6 vCPU,
12 GiB RAM, and a 120 GiB dynamically allocated disk. The production baseline
is 16 vCPU, 64 GiB RAM, and 1 TiB customer-managed storage; resizing an
evaluation VM does not itself grant production approval.

## Reproducible inputs

- Packer `1.15.4`;
- VirtualBox plugin `1.1.5` or VMware plugin `2.1.3`;
- Ubuntu Server `24.04.4` ISO with the architecture-specific SHA-256 embedded
  in `appliance/packer/nettap.pkr.hcl`;
- Ubuntu archive snapshot `20260801T000000Z`;
- exact Git commit, Git tree, and `git archive` checksum;
- immutable architecture-specific container repository digests;
- `nettap-ai:0.4.0-rc.1` and base-model identity `6488c96fa5fa`.

The ISO checksums come from Ubuntu's published `SHA256SUMS`. Packer validates
the ISO before boot. The build manifest records all of these inputs and the
installed-package inventory checksum.

## Build

Start from a clean reviewed commit:

```bash
./tests/static-checks.sh
./tests/appliance-source-checks.sh
./scripts/build-ova.sh virtualbox-arm64
```

Replace the target with the one matching the worker. The command refuses a
dirty worktree, an architecture mismatch, a missing hypervisor, or pre-existing
output. The multi-gigabyte model is deliberately embedded so first boot and the
offline acceptance repeat do not require registry egress.

Do not publish the result yet. Follow [OVA import acceptance](APPLIANCE_ACCEPTANCE.md).
