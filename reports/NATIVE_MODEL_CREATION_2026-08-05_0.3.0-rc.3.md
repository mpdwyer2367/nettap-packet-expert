# Native model creation — NetTAP Network Intelligence 0.3.0-rc.3

Date: 2026-08-05

Environment: restricted Linux x86_64 engineering workspace

Disposition: **MODEL CREATION PASS; TARGET-HOST ACCEPTANCE STILL REQUIRED**

## Verified results

| Check | Result | Evidence |
|---|---|---|
| Ollama runtime identity | PASS | Official Linux x86_64 Ollama `0.32.5`; archive SHA-256 `f7d6bdbcf71b83aa8670c4e7dc4b6936c0952fcf8b114eaf6a11cbadb9684214` |
| Base-model download | PASS | `qwen2.5:7b-instruct-q4_K_M`; Ollama manifest SHA-256 `845dbda0ea48ed749caafd9e6037047aa19acfcfd82e704d7ca97d631a0b697e` |
| Combined-model creation | PASS | Repository installer created `nettap-ai:0.3.0-rc.3` |
| Combined-model identity | PASS | Ollama manifest SHA-256 `00a615ed09122e2af5195be67412ad3d585d39cd18829c79e441e68882c875b3` |
| Weight format | PASS | Qwen2, 7.6B parameters, Q4_K_M, 4,683,073,952-byte shared model layer |
| Combined policy | PASS | Rendered Modelfile contains the retained `You are NetTAP AI` RC3 identity marker plus Network & Visibility and Packet Expert modes |
| CPU model load | PASS | Packaged x64 CPU backend loaded the full model and initialized a 512-token context |
| Token generation | ENVIRONMENT-LIMITED | Generation entered prompt evaluation, but the restricted workspace terminated the 4.7 GB runner workload; no generated answer was recorded |

## Installer correction

The first execution exposed a shell-verification defect. The installer piped a
large rendered Modelfile through `grep -q` while `pipefail` was active. On this
host's 4 KiB pipe buffer, `grep` could exit after a match and cause the upstream
`printf` to receive SIGPIPE, producing a false missing-capability error.

The verifier now uses Bash string matching, which neither truncates the policy
nor creates a pipeline. `tests/native-model-installer-mock.sh` emits a rendered
policy much larger than the pipe buffer and provides CI regression coverage.

## Scope boundary

This result proves that the pinned base model can be downloaded and the combined
NetTAP model can be created, identified and loaded through Ollama. It does not
exercise Docker, Open WebUI, offline RAG, browser authentication, backup/restore,
or the macOS and Windows deployment procedures.

Production certification remains **NOT GRANTED**. Clean macOS and Windows/WSL2
acceptance must use the same final commit and package and must complete all
release gates in `RELEASE_ACCEPTANCE_0.3.0-rc.3.md`.
