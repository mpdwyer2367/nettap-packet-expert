# Appliance acceptance evidence

Every released OVA is identified by SHA-256. Evidence from a different hash is
invalid. Record each gate as `PASS`, `FAIL`, `BLOCKED`, or `NOT EXECUTED`.

| Gate | Required evidence |
|---|---|
| Source | `source-gate.sh` log and source commit |
| Build | Packer manifest and native host architecture |
| Package | OVA SHA-256, SPDX SBOM, signed release manifest |
| Import | Hypervisor/version, import log and allocated resources |
| Boot | VM console and SSH reachability |
| Setup | Redacted `nettapctl setup` log and HTTPS health |
| Evidence | Synthetic PCAP and PCAPNG parsed by `nettap-tshark-metadata` |
| AI | Non-empty local `nettap-ai` inference response |
| Report | Valid PDF beginning `%PDF-1.4` |
| Persistence | Post-reboot `nettapctl acceptance --phase post-reboot` log |
| Recovery | Backup, isolated restore and checksum-verification logs |

After importing and completing the console-guided SSH bootstrap, run:

```bash
sudo nettapctl setup --hostname nettap-ai.local --admin-email admin@example.com
sudo nettapctl acceptance --phase runtime
sudo reboot
sudo nettapctl acceptance --phase post-reboot
```

The runtime phase stores evidence in `/var/lib/nettap/acceptance`. Copy that
directory to the release evidence store and bind it to the OVA SHA-256. Do not
publish bootstrap credentials, API tokens, raw customer captures or model
responses containing customer data.
