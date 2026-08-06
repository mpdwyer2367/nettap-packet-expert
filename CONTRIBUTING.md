# Contributing

NetTAP Network Intelligence accepts changes through reviewed pull requests. Do not commit secrets, credentials, TLS keys, customer evidence, packet captures, backups, generated private reports, model weights, or unapproved third-party binaries.

Before opening a pull request:

```bash
chmod +x scripts/* tests/*.sh
./tests/static-checks.sh
```

Changes to the Modelfile, knowledge, authentication, network exposure, images, licenses, backup/restore, or release gates require explicit security and product review. Runtime-affecting changes require fresh host evidence. Keep source commits focused and document capability boundaries and rollback.

Report vulnerabilities privately according to [SECURITY.md](SECURITY.md), not through a public issue.
