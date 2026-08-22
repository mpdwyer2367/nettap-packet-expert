# Release gates

Every gate is fail-closed. `Blocked` and `not run` are not passes.

| Milestone | Required outcome | Current disposition |
|---|---|---|
| RC3 installation qualification | Clean macOS, Windows/WSL2, and Linux installation; shared model; two profiles; offline RAG; restart, backup, restore, and rollback evidence | Historical automation exists; clean three-platform acceptance is not complete |
| RC4 evidence workspace | Validated local evidence, deterministic analysis, resolvable citations, reports, persistence, authorization, and malicious-input coverage | In progress; exact citations and bounded PCAP/PCAPNG metadata are implemented, but deep-parser isolation and enterprise authorization are incomplete |
| 0.4 connected visibility | Documented read-only NetTAP device adapters and hardware acceptance per model/firmware | Blocked on documented device APIs and hardware |
| 0.5 controlled operations | Approved plans, state revalidation, audited writes, post-checks, and tested rollback | Disabled by design |
| 1.0 commercial appliance | Signed x86_64 appliance, licensing, updates, DR, SBOM disposition, penetration testing, legal/support approval, and pilot outcomes | Not started or externally blocked |

## Evidence required for the current RC4 decision

- Exact source commit, Git tree, package checksum, and signature verification.
- Clean macOS and Windows/WSL2 results from the identical package; Linux acceptance before claiming Linux support.
- One-base/one-model identity and storage measurement.
- Offline RAG, both profiles, Skills, evidence service, restart, backup, restore, and failed-update rollback.
- Citation resolution and negative cross-case authorization tests.
- Packaged parser identity, limits, failure behavior, and malicious-input results.
- SBOM and documented disposition for every critical or high vulnerability.
- Independent penetration-test, legal, privacy, third-party, support, and authorized release decisions.

The development-host results in `docs/current-state.md` demonstrate source behavior only.
They do not promote the release beyond controlled evaluation.
