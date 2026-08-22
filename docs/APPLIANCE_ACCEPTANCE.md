# OVA acceptance workflow

An OVA is releasable only after the matching artifact is imported on the
matching hypervisor and native architecture. Source validation or successful
export is not import acceptance.

## Automated host phase

Start the importer and leave the VM running:

```bash
./tests/ova-import-acceptance.sh \
  --target virtualbox-arm64 \
  --ova dist/nettap-ai-0.4.0-rc.1-virtualbox-arm64.ova \
  --evidence-dir /protected/nettap-vbox-arm64 \
  --confirm
```

This checks the OVA hardware metadata, performs a clean import, confirms SSH
and HTTPS first boot, reboots the VM, repeats health, and records hypervisor
evidence. It exits incomplete until guest evidence is supplied.

## Guest phase

After changing the one-time SSH password, run in the imported guest:

```bash
sudo nettapctl guest-smoke --full
```

The full smoke test checks unique identity and secrets, systemd/firewall/audit
controls, internal runtime networks, both managed assistants, local PCAP and
PCAPNG TShark decoding, raw-payload exclusion, one bounded inference, encrypted
backup, isolated restore, and evidence/chat database continuity. Copy the
generated report from `/var/lib/nettap/reports` to the host.

Repeat the host command with `--guest-report <copied-report>` and optionally
`--cleanup`. Only then does it write `Overall result: PASS`.

## Bundle gate

```bash
./scripts/package-appliance-bundle.sh \
  dist/nettap-ai-0.4.0-rc.1-virtualbox-arm64.ova \
  dist/evidence/virtualbox-arm64/*.build-manifest.json \
  dist/evidence/virtualbox-arm64/*.sbom.cdx.json \
  /protected/nettap-vbox-arm64/acceptance-report.md
```

Set `COSIGN_KEY` to an authorized key to add signed provenance and artifact
signatures. Without that key, the complete unsigned evidence bundle can be
reviewed but must not be represented as signed. Repeat independently for all
four artifact rows.
