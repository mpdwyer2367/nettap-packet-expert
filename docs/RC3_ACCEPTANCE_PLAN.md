# RC3 acceptance plan

## Decision boundary

NetTAP Network Intelligence `0.3.0-rc.3` becomes eligible for a production-candidate decision only after the exact signed package passes both supported-host runs and every independent approval below. Source CI or one host alone cannot grant production, customer, or commercial approval.

## Frozen candidate identity

The release manager records and signs:

- source archive and SHA-256;
- provenance containing version, full Git commit, exact Git tree and package SHA-256;
- artifact and provenance signatures;
- release public key and signing-key custody reference;
- base model name and expected ID;
- `nettap-ai:0.3.0-rc.3` model name;
- exact embedding revision;
- `provisioning/knowledge-sources.sha256`;
- platform-specific immutable container digests.

`scripts/verify-release.sh` recomputes the archive's Git tree rather than trusting the provenance text. Any mismatch, duplicate archive path, missing checksum, or bad signature stops acceptance.

## Platform execution

Use a clean, supported macOS host and a supported Windows host with WSL2/Docker Desktop. Copy the same signed release files to each host. From the extracted repository containing the acceptance runner, execute:

```bash
./tests/clean-package-acceptance.sh \
  --archive /approved/nettap-ai-suite-0.3.0-rc.3-source.tar.gz \
  --evidence-dir /protected/empty-evidence-directory \
  --public-key /approved/cosign.pub
```

The runner performs these gates in order:

1. Verify checksum, signed provenance, archive prefix and exact Git tree.
2. Extract into a temporary directory and prove the package contains no `.env` or runtime state.
3. Use a unique Compose project and prove it has no existing volumes.
4. Run the platform one-command installer with controlled bootstrap egress.
5. Pin the current platform's images to immutable digests, rehydrate the model/cache, and return to offline mode.
6. Generate the administrator credential; require password replacement, rejection of the bootstrap password, and finalization.
7. Verify ports 3000, 3001, 3100 and 3200; both managed assistants; one shared model store; exact model, embedding, knowledge and provisioning identities; offline RAG retrieval; and the authenticated Evidence Workspace workflow.
8. Execute all fourteen behavioral tests and normalized packet-derived, syslog/auth and IPFIX examples.
9. Test restart persistence, protected backup, non-overwriting restore and failed-update recovery.
10. Generate SPDX SBOMs and enforce the no-unapproved-HIGH/CRITICAL vulnerability policy.
11. Record manual browser/profile checks and export non-secret reports to the protected evidence directory.
12. Remove the temporary acceptance deployment and its volumes.

The failed-update test proves the existing offline runtime survives a deliberately rejected model identity. A cross-version rollback remains a distinct gate: restore a protected pre-upgrade backup with the prior signed package, confirm service and data, measure recovery time, and preserve that report.

## Cross-platform identity check

After both runs:

```bash
./tests/compare-platform-acceptance.sh \
  /protected/macos/macos-acceptance-summary.txt \
  /protected/windows/windows-wsl2-acceptance-summary.txt
```

The command requires matching version, commit, tree, package filename, package SHA-256, base/combined model IDs, embedding aggregate SHA-256 and provisioning fingerprint, plus passing signature verification on both hosts. Container digests are recorded per host because the registry may resolve a multi-platform image to platform-specific content; the security and release reviewers must approve both recorded sets.

## Required independent records

| Record | Required owner | Release condition |
|---|---|---|
| macOS runtime | QA | Clean-package result PASS |
| Windows/WSL2 runtime | QA | Same package result PASS |
| Cross-platform identity | Release/QA | Comparison PASS |
| Vulnerability disposition | Security | SBOM reviewed; no unapproved findings |
| Penetration-test disposition | Independent security reviewer | Findings remediated or formally accepted |
| Legal/third-party/branding | Legal | Written approval for scope and distribution |
| Support readiness | Support/Product | Supported-host matrix, SLA, escalation, updates and EOL approved |
| Commercial approval | Authorized business owner | Written distribution approval |
| Release acceptance | Authorized release owner | Signed record tied to exact package and all evidence |

Never place credentials, private keys, customer evidence, raw captures, or protected reports in Git. The certification command remains fail-closed until the authorized private records exist and match the exact candidate.
