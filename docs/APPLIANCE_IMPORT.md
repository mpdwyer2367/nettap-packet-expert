# OVA import guide

Before import, verify the bundle:

```bash
./scripts/verify-appliance-bundle.sh /approved/nettap-ai-0.4.0-rc.1-<hypervisor>-<architecture>
```

This deliberately fails for candidate bundles or incomplete acceptance.

## VirtualBox

1. Use **File → Import Appliance** and select the VirtualBox OVA matching the
   host architecture.
2. Retain the supplied 6 vCPU, 12 GiB memory, dynamically allocated disk, and
   one NAT adapter for evaluation.
3. Start the VM and open its console. Never import an amd64 OVA on Arm or an
   Arm OVA on x86 through emulation and call it accepted.

## VMware Workstation or Fusion

1. Open the VMware OVA matching the host architecture.
2. Retain the supplied evaluation resources and NAT adapter.
3. Start the VM and open its console.

The first startup can take several minutes while preloaded model state is
verified and the two managed assistants are reconciled. Generic OVAs provide
CPU inference. They make no Metal, CUDA, or unqualified accelerator-passthrough
performance claim.

Continue with [first boot](APPLIANCE_FIRST_BOOT.md). Release managers must use
the scripted [acceptance workflow](APPLIANCE_ACCEPTANCE.md), not a visual import
alone.
