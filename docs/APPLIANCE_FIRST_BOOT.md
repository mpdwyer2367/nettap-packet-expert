# Appliance first boot

The console prints unique, one-time SSH and Open WebUI bootstrap credentials.
No shared production password is embedded in the OVA. The same record is
available only to root at `/var/lib/nettap/state/bootstrap.txt`.

1. Record the SSH host-key fingerprint and compare it on first connection.
2. Sign in as `nettap-admin`; the OS forces an immediate password change.
3. Browse to `https://<appliance-address>:8443/`. The initial certificate is a
   unique 30-day self-signed bootstrap certificate.
4. Sign in with the displayed Open WebUI credential and change it immediately.
5. Verify the old WebUI bootstrap password fails, then run
   `sudo nettapctl finalize-admin`.
6. Install the customer-approved DNS certificate and key:

   ```bash
   sudo nettapctl configure-tls \
     --hostname nettap-ai.customer.example \
     --certificate /secure/tls.crt \
     --private-key /secure/tls.key
   ```

7. Run `sudo nettapctl status`, `sudo nettapctl health`, and inspect the build
   identity with `sudo cat /etc/nettap/build-manifest.json`.

## Encrypted backup

Backups require an external age recipient; the appliance never stores the
recovery identity with the backup:

```bash
age-keygen -o /secure/nettap-recovery.key
recipient="$(age-keygen -y /secure/nettap-recovery.key)"
sudo nettapctl backup --recipient "$recipient"
```

Restore always creates isolated volumes and never overwrites a deployment:

```bash
sudo nettapctl restore /var/lib/nettap/backups/nettap-<timestamp>.tar.age \
  --identity /secure/nettap-recovery.key \
  --target-prefix recovery-test-01
```

Protect the recovery identity under the customer's approved key-custody and
escrow policy.
