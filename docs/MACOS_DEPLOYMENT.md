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

Use `admin@nettap.local` with the password in the protected file printed by the script. Change it immediately, verify the generated password fails, and run:

```bash
./scripts/finalize-admin.sh --confirm
```

There is no shared default password. Existing volumes retain existing accounts and passwords.

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

## Apple Silicon boundary

The Docker profile is CPU-compatible. Docker Desktop does not expose Apple Metal acceleration to the Linux Ollama container. A separate native-Ollama profile would require a different connection, lifecycle, security, backup, and acceptance procedure and is not claimed by this release.

Existing Packet Expert 0.2 users must follow [the migration guide](MIGRATION.md) before changing the checkout.
