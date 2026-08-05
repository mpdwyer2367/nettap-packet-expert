# Deployment validation status

## Current candidate

| Item | Value |
|---|---|
| Release | `0.2.0-rc.1` |
| Model | `nettap-packet-expert:0.2.0-rc.1` |
| Architecture | Single-node, single-customer Docker software appliance |
| Local URL | `http://127.0.0.1:3001` |
| Production URL | Customer TLS hostname, port `8443` by default |

## Current evidence

| Gate | Status |
|---|---|
| Production source controls | Implemented; CI must pass on the published commit |
| Immutable image locking | Implemented; release evidence pending |
| SBOM and HIGH/CRITICAL CVE gate | Implemented; release scan pending |
| Backup and non-overwriting restore | Implemented; physical-host recovery test pending |
| macOS production runtime | Pending physical-host report |
| Windows production runtime | Pending physical-host report |
| Browser/manual acceptance | Pending exact release build |
| Expanded domain accuracy/safety eval | Pending approved test set and thresholds |
| Independent penetration test | Pending |
| Legal/third-party/branding approval | Pending |
| Support readiness and SLA | Pending |
| Signed artifact and acceptance | Pending |
| Production/commercial certification | **NOT GRANTED** |

Static analysis in this workspace cannot prove Docker runtime, browser authentication, model download/inference, TLS behavior, backup recovery, platform compatibility, performance, penetration resistance, or commercial rights. Those gates require the target environments and authorized reviewers.

## Required commands

```bash
./tests/static-checks.sh
./scripts/lock-images.sh --confirm
./scripts/security-scan.sh
./scripts/production-preflight.sh
./scripts/start-production.sh
./scripts/verify-production-deployment.sh
./tests/model-behavior-eval.sh
./scripts/backup.sh /protected/test-backup
./scripts/restore.sh /protected/test-backup --target-prefix acceptance-restore
./scripts/certify-production.sh
```

The last command must fail until all external evidence files in [commercial release gates](COMMERCIAL_RELEASE_GATES.md) are present and reviewed. A successful script result still requires the named authorized approver to sign the release acceptance record.

## Claim rules

Use “source validated” only for a passing exact commit. Use “runtime verified” only with a named host report. Use “customer accepted” only for that customer deployment. Use “commercially approved” or “production certified” only after the entire defined gate and approval scope is complete.
