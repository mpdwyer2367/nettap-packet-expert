# Deployment validation status

## Current release

- Release: `0.1.0-rc.8`
- Canonical Compose project: `nettap-packet-expert`
- Canonical model: `nettap-packet-expert:0.1.0-rc.8`
- Local URL: `http://127.0.0.1:3001`

## Status definitions

| Status | Meaning |
|---|---|
| Source validated | Static checks, syntax, configuration structure, required controls, documentation links, and secret-pattern checks pass. |
| Automated runtime verified | The canonical containers originate from one working directory and Compose file; images, model, UI health, administrator presence, loopback binding, isolation, inference, and restart checks pass on the named host. |
| Manually accepted | A tester completes fresh-install login, password replacement, old-password rejection, password persistence, model selection, starter-prompt, knowledge, and browser-chat checks. |
| Release accepted | The automated report and signed manual acceptance record are attached to the exact release commit and approved for the stated platform. |

## RC8 status

| Gate | Status |
|---|---|
| Repository source validation | PASS |
| macOS automated runtime verification | PENDING PHYSICAL-HOST REPORT |
| macOS manual browser acceptance | PENDING |
| Windows automated runtime verification | NOT IMPLEMENTED IN RC8 |
| Windows manual runtime acceptance | PENDING |
| Production-appliance certification | NOT CLAIMED |

The repository must not describe RC8 as fully runtime validated until a sanitized report from `scripts/verify-macos-deployment.sh` or `tests/macos-e2e.sh` and the completed manual acceptance record are attached to the exact commit being released.

## Canonical macOS verification

Run from the single Git working copy intended to own the deployment:

```bash
git pull --ff-only
chmod +x scripts/*.sh tests/*.sh
./tests/static-checks.sh
./scripts/start-macos.sh
./scripts/verify-macos-deployment.sh
./tests/macos-e2e.sh
```

An independent evaluator can run the consolidated clean-room entry point:

```bash
./tests/colleague-macos-acceptance.sh
```

See [`COLLEAGUE_EVALUATION_GUIDE.md`](COLLEAGUE_EVALUATION_GUIDE.md).

The runtime verifier fails when Ollama and Open WebUI were created from different working directories or Compose files. This prevents a mixed-provenance Compose project from being accepted merely because both containers happen to be running.

## Manual acceptance

Complete `reports/RELEASE_ACCEPTANCE_TEMPLATE.md` and verify:

1. A fresh Open WebUI volume creates `admin@nettap.local` with temporary password `admin`.
2. The administrator replaces the password before any network exposure.
3. The old password fails and the new password survives restart.
4. Signup remains disabled.
5. `nettap-packet-expert:0.1.0-rc.8` is selected.
6. Four broad starter prompts appear.
7. The approved knowledge file is imported, attached, permissioned, and retrievable.
8. The assistant does not claim that unconnected traffic, packets, telemetry, captures, or tools are live.
9. Open WebUI is available only at `127.0.0.1:3001` for the supplied local profile.
10. No customer evidence, password, token, private packet payload, or other sensitive data is present in the report.

## Evidence required for a validation claim

- exact Git commit and release tag;
- macOS version and architecture;
- Docker Desktop, Engine, and Compose versions;
- container image names and immutable digests;
- model identity;
- automated report with all checks passing;
- completed manual acceptance record;
- approver and approval date;
- known limitations and exceptions.

Static CI is necessary but is not proof that Docker Desktop, model initialization, browser authentication, persistence, or inference works on a target host.
