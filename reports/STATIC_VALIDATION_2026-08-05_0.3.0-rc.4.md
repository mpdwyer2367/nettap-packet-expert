# Static validation baseline — NetTAP Network Intelligence 0.3.0-rc.4

Recorded date: 2026-08-05

This record defines the source checks required for the exact RC4 commit:

- Bash syntax and ShellCheck
- PowerShell parser validation
- Compose rendering for local, bootstrap, and production profiles
- one-model retirement regression checks
- native model installer identity checks
- Open WebUI provisioning and offline-RAG contract tests
- Evidence Workspace parser and API tests
- documentation-link and naming checks
- source and model-bundle packaging and checksum verification

GitHub Actions and target-host evidence must identify the exact final commit.
Static validation cannot establish macOS or Windows runtime behavior, security
certification, legal approval, or commercial readiness.

Local source result: **PASS** for Bash syntax, static controls, naming and
documentation links, native-model and retirement mocks, and 17 Python unit/API
tests. ShellCheck, PowerShell parsing, Compose rendering, archive verification,
and exact-commit status remain assigned to GitHub Actions.
