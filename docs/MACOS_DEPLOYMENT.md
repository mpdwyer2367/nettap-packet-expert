# macOS deployment

## New installation

1. Install Docker Desktop and start its engine.
2. Allocate at least 8 CPUs and 24 GiB host memory, with at least 16 GiB available to Docker when the host permits it.
3. Clone the reviewed repository release.
4. Run:

```bash
chmod +x scripts/* tests/*.sh
./scripts/start-macos.sh
```

The first start downloads the approved Qwen3.5 9B Q4_K_M base and exact offline embedding revision, verifies them, builds one combined `nettap-ai:0.4.0-rc.1` model, removes temporary egress, provisions three knowledge collections and two Workspace Models, proves offline retrieval, retires older NetTAP container tags, and then starts one Open WebUI with two stateless experience launchers.

`nettap-ai-suite-0.4.0-rc.1` is the source-package name and does not appear in the Ollama model selector. The expected runtime model tag is `nettap-ai:0.4.0-rc.1`.

For an existing installation that still shows `nettap-ai:0.3.0-rc.4`, run:

```bash
./scripts/nettap-ai update-models --confirm
./scripts/nettap-ai status
```

The status output must contain `qwen3.5:9b-q4_K_M` and `nettap-ai:0.4.0-rc.1`. Open <http://127.0.0.1:3000> for the managed Network & Visibility RAG profile, <http://127.0.0.1:3001> for the managed Packet Expert RAG profile, or <http://127.0.0.1:3100> for the shared Open WebUI.

Open:

- <http://127.0.0.1:3000> — Network & Visibility
- <http://127.0.0.1:3001> — Packet Expert
- <http://127.0.0.1:3100> — shared Open WebUI
- <http://127.0.0.1:3200> — authenticated local Evidence Workspace; token in `.evidence-api-token`

Read the local login from `.bootstrap-admin-password`. Change its bootstrap password immediately, verify the old value fails, and run:

```bash
./scripts/finalize-admin.sh --confirm
```

Production preflight rejects the local default password. Existing volumes retain existing accounts and passwords; use `./scripts/nettap-ai reset-default-admin --confirm-insecure-default` only when intentionally restoring the documented loopback credential.

To verify restored evidence upload, open port 3100, select **NetTAP Network
Intelligence — Packet Expert**, attach a small authorized `.pcap`, `.pcapng`, `.jsonl`, or
`.log` file, and ask for an evidence-supported analysis. The response must cite
Evidence Workspace IDs and limitations. PCAP and PCAPNG use the bounded
payload-free metadata parser; deeper protocol claims still require reviewed
TShark-derived normalization.

## Validation

```bash
./tests/static-checks.sh
./tests/macos-e2e.sh
```

Complete the manual checks printed by the test, including both profiles, profile-specific launchers, shared model identity, specialist knowledge isolation, restart persistence, backup, and rollback.

For release acceptance, do not validate a mutable checkout. Copy the signed archive, checksum, provenance, artifact/provenance signatures, and release public key to the host, then run:

```bash
./tests/clean-package-acceptance.sh \
  --archive /approved/nettap-ai-suite-0.4.0-rc.1-source.tar.gz \
  --evidence-dir /protected/nettap-040rc1-macos \
  --public-key /approved/cosign.pub
```

The evidence directory must be empty. The test uses a unique Compose project and verifies empty initial volumes. `--allow-unsigned-evaluation` is available only for non-release evaluation and cannot produce signature-passing release evidence. Preserve the generated summary and supporting reports outside the temporary runtime. See the [0.4.0-rc.1 acceptance plan](0.4.0_RC1_ACCEPTANCE_PLAN.md).

## Apple Silicon accelerated evaluation

Docker Desktop on macOS does not expose Apple Metal acceleration to the Linux
Ollama container. A 16 GiB Apple-silicon Mac should therefore use the native
Ollama application for evaluation instead of loading the 6.6 GB model in both
Docker and macOS.

Configure the native server conservatively, restart the application, install the
release model into the native model store, and point only Open WebUI at it:

```bash
launchctl setenv OLLAMA_HOST 0.0.0.0:11434
launchctl setenv OLLAMA_MAX_LOADED_MODELS 1
launchctl setenv OLLAMA_NUM_PARALLEL 1
launchctl setenv OLLAMA_KEEP_ALIVE 2m
osascript -e 'quit app "Ollama"'
open -a Ollama

./scripts/nettap-ai install-native-model --confirm-download
```

Set this value in the local `.env`:

```dotenv
OPEN_WEBUI_OLLAMA_BASE_URL=http://host.docker.internal:11434
```

Then recreate Open WebUI and leave the Compose Ollama service idle. Both managed
Workspace Models remain pinned to `nettap-ai:0.4.0-rc.1`; Network & Visibility
and Packet Expert are profiles over that one runtime model, not additional model
downloads. The release model uses a 4096-token context for laptop-safe testing.

`OLLAMA_HOST=0.0.0.0:11434` makes the unauthenticated native Ollama API listen
on every Mac interface so Docker Desktop can reach it. Use this evaluation mode
only on a trusted network with the macOS firewall enabled. Revert to the
container backend after testing by setting
`OPEN_WEBUI_OLLAMA_BASE_URL=http://ollama:11434`, clearing the four
`launchctl` variables, and restarting Ollama.

This native-backend path is an evaluation convenience. Production acceptance
continues to use the isolated Compose Ollama service and its documented backup
and security boundary.

Existing Packet Expert 0.2 users must follow [the migration guide](MIGRATION.md) before changing the checkout.
