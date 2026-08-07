# macOS deployment guide

## Requirements

- Apple Silicon or Intel macOS supported by current Docker Desktop
- Docker Desktop with Compose v2 running
- 16 GB host RAM minimum (24 GB recommended), 12 GB Docker memory, 6 CPU cores and at least 20 GiB free disk
- Internet access during the first controlled installation only

## Clean installation

```bash
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
cd nettap-packet-expert
git rev-parse HEAD
./scripts/nettap-ai start-local
```

The start command creates local secrets, downloads pinned container images and the approved multimodal Qwen3.5 9B base, caches the exact embedding revision, builds `nettap-ai:0.3.0-rc.8`, provisions the combined assistant and knowledge, removes temporary egress and starts the offline runtime. Cached downloads are reused after an interrupted installation.

Open <http://127.0.0.1:3100>. Use `admin@nettap.local` and the unique password in `.bootstrap-admin-password`. Change it immediately, sign out, verify the generated value fails, then run:

```bash
./scripts/finalize-admin.sh --confirm
```

## Verification

```bash
./scripts/nettap-ai status
./scripts/nettap-ai health
./scripts/verify-macos-deployment.sh
```

The automated verifier checks one current NetTAP tag, service provenance, one loopback UI, internal-only Ollama/evidence services, the combined assistant, Filter, knowledge, pinned embedding and controlled model inference. Complete manual browser, attachment, password, backup/restore and rollback acceptance separately.

## Evidence test

In the chat, attach an authorized `.pcap`, `.json`, `.jsonl`, `.ndjson`, `.log`, `.txt`, `.png`, `.jpg`, `.jpeg` or `.webp` file and state the troubleshooting or investigation goal. Confirm record analysis identifies evidence hash/ID and quality limitations; confirm image analysis distinguishes visible labels/topology from inference. Do not upload secrets or unauthorized traffic.

## Upgrade

```bash
./scripts/nettap-ai backup /absolute/secure/backup/path --confirm-stop
git fetch --tags origin
git checkout <approved-release-tag-or-commit>
./scripts/nettap-ai start-local
./scripts/verify-macos-deployment.sh
```

Never run an unreviewed branch in production. Existing volumes keep their accounts and password. See [Administrator guide](ADMINISTRATION.md) for recovery and rollback.

## Uninstall

`./scripts/nettap-ai stop` stops containers and preserves data. Volume deletion is intentionally not part of the normal uninstall workflow; back up and obtain explicit authorization before removing persistent volumes.
