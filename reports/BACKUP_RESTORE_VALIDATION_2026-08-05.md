# Backup and restore validation — 2026-08-05

## Scope

This report records the documented non-overwriting recovery acceptance test for
NetTAP Packet Expert `0.3.0-rc.1` source revision
`aff27eee758fc3cce8726005c2527dcca797e91d`.

The test ran on a physical Apple Silicon host with:

- macOS 26.5.2 (build 25F84), `arm64`;
- Docker client and server 29.6.2;
- Docker Compose v5.3.1; and
- the repository-pinned `alpine:3.24.1` backup utility image.

The evidence-only documentation commit that adds this report does not change
the deployment, backup, restore, or test implementation exercised above.

## Procedure and result

Command:

```bash
./tests/backup-restore-e2e.sh
```

Result: **PASS**.

The test:

1. created consistent archives of the Packet Expert Ollama and Open WebUI named
   volumes;
2. verified the archive and manifest checksums;
3. restored into fresh, uniquely named volumes without attaching them to or
   overwriting a running deployment;
4. verified that the restored model volume was nonempty and that the restored
   Open WebUI volume contained `webui.db`; and
5. removed the temporary backup directory and restore-test volumes through its
   cleanup trap.

The source volumes remained intact. Generated credentials and backup contents
were not included in this report.

## Limitations

This is macOS recovery evidence only. It does not satisfy the required physical
Windows 11, WSL2, and Docker Desktop runtime gate, and it does not grant
production or commercial approval.
