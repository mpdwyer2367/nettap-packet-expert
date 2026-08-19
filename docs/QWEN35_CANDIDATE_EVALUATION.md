# Qwen3.5 9B controlled candidate evaluation

## Purpose

This lane evaluates Qwen3.5 9B beside the working RC4 model. It does not replace, retag, rebuild, or promote RC4.

| Field | Baseline | Candidate |
|---|---|---|
| Runtime | `nettap-ai:0.3.0-rc.4` | `nettap-ai:0.4.0-qwen35-9b-rc.1` |
| Base | `qwen2.5:7b-instruct-q4_K_M` | `qwen3.5:9b` |
| Verified base ID | `845dbda0ea48` | `6488c96fa5fa` |
| Context configured by NetTAP | 8192 | 16384 |
| Profiles | Two RC4 defaults | Two clearly labeled, non-default candidates |
| Status | Integration release candidate | Evaluation only |

The Qwen3.5 base identity and license were checked against the published Ollama model entry: <https://ollama.com/library/qwen3.5:9b>.

## Safety properties

- The candidate `Modelfile` is generated from `model/nettap-ai.Modelfile` at build time.
- Only the `FROM` value and `num_ctx` value change.
- The shared NetTAP evidence, authorization, privacy, and safety policy stays identical.
- Existing managed knowledge and Skills are reused read-only.
- Candidate Workspace Models use unique IDs and are not made default or pinned.
- RC4 legacy cleanup recognizes the declared evaluation manifest and preserves this candidate tag.
- The candidate lane refuses to run in production mode.
- Model-registry egress exists only during the confirmed candidate pull and is removed by a cleanup trap.
- The public base tag must resolve to the reviewed ID or the build stops.

## Operator workflow

Start from a working RC4 local deployment.

```bash
./scripts/nettap-ai candidate-model plan
./scripts/nettap-ai candidate-model build --confirm
./scripts/nettap-ai candidate-model status
./scripts/nettap-ai candidate-model provision-profiles --confirm
./scripts/nettap-ai candidate-model test
./scripts/nettap-ai candidate-model compare
```

`provision-profiles` requires the current Open WebUI administrator password when the bootstrap credential has been retired. The password is read through standard input and is not written to the candidate manifest or report.

## What the comparison does

The automated smoke comparison runs the same fourteen evidence-boundary cases against:

1. the model named by the deployed `NETTAP_AI_MODEL` value;
2. `nettap-ai:0.4.0-qwen35-9b-rc.1`.

It records separate logs, pass or fail status, and elapsed wall time under `reports/generated/model-comparison-<UTC>/`.

The comparison is a qualification input, not a promotion decision. It does not by itself prove factual accuracy, RAG quality, token throughput, memory capacity, long-context stability, platform acceptance, or production security.

## Required evidence before any promotion proposal

- All fourteen boundary tests pass for both profiles and the raw candidate model.
- NetTAP factual and packet-analysis evaluation shows a declared improvement or no material regression.
- Retrieval and citation tests pass without cross-profile leakage.
- Prompt-injection, secret-handling, unauthorized-action, and tool-permission tests pass.
- Peak memory, disk use, load time, time to first token, and response latency are measured.
- macOS, Windows/WSL2, and supported Linux acceptance use the same candidate identity.
- Backup, restore, restart, and failed-update rollback are demonstrated.
- SBOM, vulnerability, license, legal, support, and release-owner reviews are complete.

Until those gates pass, RC4 remains the selected release and both Qwen3.5 profiles remain evaluation-only.
