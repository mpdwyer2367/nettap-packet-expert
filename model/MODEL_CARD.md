# NetTAP Network Intelligence Model card

## Identity

| Field | Value |
|---|---|
| Model name | `nettap-ai:0.3.0-rc.4` |
| Release status | Release candidate; not production-certified |
| Base model | `qwen2.5:7b-instruct-q4_K_M` |
| Expected Ollama base ID | `845dbda0ea48` |
| NetTAP model definition | `model/nettap-ai.Modelfile` |
| NetTAP copyright | Copyright 2026 NetTAP Technology Limited |

The NetTAP Network Intelligence Model uses the technical tag `nettap-ai:0.3.0-rc.4`. It is one combined Ollama model definition for the Network & Visibility and Packet Expert experiences, not a separately fine-tuned weight set. Ollama creates it from the verified Qwen2.5 7B base plus the NetTAP system policy in the Modelfile, using Ollama's documented [`Modelfile` and `ollama create` workflow](https://docs.ollama.com/modelfile).

## Included product capability

| Capability | Combined Ollama policy | Specialist Open WebUI layer |
|---|---|---|
| Network architecture, TAP/SPAN/NPB design, telemetry acquisition, deployment and troubleshooting | Included | Network & Visibility prompt, Skill and RAG collection |
| Packet acquisition planning, evidence quality, PCAP-derived analysis, performance, cyber visibility and forensics | Included | Packet Expert prompt, Skill and RAG collection |
| Evidence boundaries, live-data disclosure, configuration safety, decryption handling and prompt-injection resistance | Shared and always active | Reinforced by both profiles |
| Cross-domain workflow from visibility design to evidence collection and investigation | Included as Unified mode | User may select the shared technical model or move between profiles |

The two Open WebUI Workspace Models are lightweight product profiles over the same Ollama model. They do not copy the 7B weights. Specialist Markdown knowledge and [Open WebUI Skills](https://docs.openwebui.com/features/workspace/skills/) remain versioned outside the weights so they can be reviewed, hashed, tested, and updated without pretending a RAG update is fine-tuning.

## Download and storage behavior

A clean appliance downloads the approved Qwen2.5 7B base once into one
containerized Ollama volume. `ollama create` adds the versioned NetTAP policy
manifest while reusing the base model's content-addressed weight blobs. Network
& Visibility and Packet Expert are Open WebUI profiles, not separately
downloaded Ollama models. The offline embedding model is a smaller, separate RAG
dependency and is not another chat LLM.

Ollama model names and tags are independent manifests. Initialization creates
`nettap-ai:0.3.0-rc.4`, provisions both Open WebUI profiles against it, verifies
the current model, and then retires older recognized NetTAP tags from the
containerized appliance store. An administrator can audit or repeat retirement with
`./scripts/nettap-ai retire-old-models` and
`./scripts/nettap-ai retire-old-models --confirm`. The full Docker deployment
never modifies a separate host-native store by default. Its `--include-native`
option is explicit. The native-only installer is itself a host-store action and
retires recognized older native NetTAP tags only after RC4 identity verification.

## Installation options

For the full supported evaluation deployment—including the two assistants, offline RAG, accounts, chat history, launchers and automatic provisioning—follow the repository `README.md`.

To create only the combined model in an already running native Ollama installation:

```bash
./scripts/install-model-native.sh --confirm-download
ollama run nettap-ai:0.3.0-rc.4
```

On Windows PowerShell:

```powershell
.\scripts\install-model-native.ps1 -ConfirmDownload
ollama run nettap-ai:0.3.0-rc.4
```

The installer downloads the pinned base, requires its expected Ollama ID, creates the combined model, verifies that both product modes are present, and then removes superseded native NetTAP tags while retaining the base and non-NetTAP models. After installation, ordinary local inference does not require a model-registry download. Full-suite startup separately caches the pinned RAG embedding model and returns the supplied application to offline runtime.

## Distribution

The GitHub repository and model bundle intentionally contain the Modelfile, assistant manifests, Skills, knowledge, installers, hashes and documentation—not the multi-gigabyte third-party base-model blob. This avoids duplicating shared weights, keeps third-party licensing and integrity boundaries visible, and avoids using ordinary Git history as model-artifact storage. GitHub [blocks regular repository files larger than 100 MiB](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github).

An authorized release manager can build the downloadable source bundle with:

```bash
./scripts/package-model-bundle.sh
./scripts/verify-model-bundle.sh dist/nettap-ai-model-0.3.0-rc.4.tar.gz
```

The generated provenance explicitly records that weights are not embedded. A public Ollama registry name has not been claimed by this repository. Publishing one requires a controlled NetTAP registry account, release authorization, third-party license review, artifact signing and the same acceptance evidence as the repository release.

## Intended use and limitations

- Intended for authorized network architecture, visibility, operations, performance, cyber-visibility and forensic-assistance workflows.
- No live network data exists unless an approved connector explicitly supplies current evidence.
- Raw data requires an approved deterministic parser and validated schema before dependable correlation.
- The model does not replace a TAP, packet broker, collector, packet decoder, SIEM, IDS/IPS, NDR, network controller or forensic source of truth.
- Outputs require qualified human review; security conclusions must remain evidence-supported indicators or hypotheses.
- Decryption secrets must never be supplied to the LLM. Authorized decryption occurs locally in an isolated deterministic analysis service, and only minimized results reach the model.
- Tools are disabled by default. Skills are instructions, not evidence that a connector or executable tool is installed.

## Validation status

Source tests cover model identity, both capability modes, managed Skill and RAG provisioning, profile isolation, one-model retirement, archive safety and fail-closed configuration. Target-host macOS and Windows/WSL2 acceptance, SBOM/CVE disposition, independent penetration testing, legal/support/commercial approval and signed release acceptance remain mandatory before production or commercial distribution. See `docs/VALIDATION_STATUS.md` and `reports/RELEASE_ACCEPTANCE_0.3.0-rc.4.md`.
