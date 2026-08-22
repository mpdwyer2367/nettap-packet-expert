# NetTAP Security and Data Handling

## Prototype boundary

The default standalone agent sends decoded packet evidence to a hosted development endpoint. This is not equivalent to a private, self-contained MATRIX-AI-SDN appliance.

Use authorized lab traffic until the complete data path has approved tenancy, encryption, access, retention, deletion, auditing, update, and incident-response controls.

## Evidence content

`tshark -T ek` can emit detailed protocol records, including addresses, MAC and VLAN data, DNS names, TLS handshake metadata, visible HTTP fields, infrastructure identifiers, and unencrypted application fields. Calling this output metadata does not guarantee that it excludes sensitive information.

## Required controls

- Written capture authorization and stated purpose
- Dedicated least-privilege service account
- Separate management and capture interfaces when practical
- Session-scoped and revocable credentials
- TLS certificate validation
- Restricted and encrypted spool storage
- Retention, deletion, and disk-full policies
- Tenant-bound authorization
- Audit logs for pairing, token lifecycle, collection, upload, access, and deletion
- Monitoring for drops, spool growth, authentication failure, and backend rejection

## Secret handling

Never commit or publish:

- Supabase service-role keys
- Database passwords
- Collector pairing tokens
- Live-capture session tokens
- SNMP communities or SNMPv3 keys
- SSH, WMI, API, or broker credentials
- Authorization headers

Do not pass secrets as command-line arguments on shared systems. Command lines can appear in process listings, shell history, remote-management logs, or endpoint telemetry.

## Git protection

The root `.gitignore` must exclude local `.env` files, packet captures, decoded evidence, spool data, and generated appliance images. Enable GitHub secret scanning and push protection.

If a credential reaches Git history, revoke or rotate it immediately. Removing it from the latest commit is not sufficient.

## Production readiness gaps

Before calling this commercially available, implement and validate:

- Signed installers, images, and update artifacts
- Reproducible builds, SBOM, and release provenance
- Authenticated updates with rollback
- Device identity, enrollment, and certificate rotation
- Short-lived token renewal
- Bounded encrypted spool with retry and quarantine behavior
- Payload schema versioning
- Field-level minimization and suppression
- Resource limits and service watchdogs
- Backup and restore testing
- Import-tested OVF/OVA packaging for each supported hypervisor
- Documented vulnerability and incident-response process

