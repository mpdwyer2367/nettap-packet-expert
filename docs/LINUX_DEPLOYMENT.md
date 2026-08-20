# Linux deployment

## Requirements

- Supported 64-bit Linux distribution with Docker Engine and Docker Compose v2
- A current user allowed to access the Docker daemon
- Git, Bash, curl and Python 3
- At least 20 GiB free disk for evaluation
- Recommended host allocation: 8 CPUs and 24 GiB memory

## New installation

```bash
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
cd nettap-packet-expert
chmod +x scripts/* tests/*.sh
./scripts/start-linux.sh
```

The first start downloads and verifies `qwen3.5:9b-q4_K_M` with expected Ollama ID `6488c96fa5fa`, builds `nettap-ai:0.4.0-rc.1`, caches the pinned embedding model, removes temporary registry egress, provisions both managed Open WebUI profiles and proves offline retrieval.

Open the Network & Visibility launcher at <http://127.0.0.1:3000>, Packet Expert at <http://127.0.0.1:3001>, shared Open WebUI at <http://127.0.0.1:3100>, and the Evidence Workspace at <http://127.0.0.1:3200>.

Use `admin@nettaptech.com` with the local default password `Password!`. Change it immediately, verify the default password no longer works, then run:

```bash
./scripts/finalize-admin.sh --confirm
```

## Verification

```bash
./tests/static-checks.sh
docker compose --env-file .env -f compose.yaml -f compose.local.yaml ps
docker compose --env-file .env -f compose.yaml -f compose.local.yaml exec -T ollama ollama show nettap-ai:0.4.0-rc.1
./tests/model-behavior-eval.sh
./tests/normalized-ingestion-eval.sh
```

The native Linux path is supported for controlled evaluation. Production or commercial approval still requires the exact signed package and every gate in the [0.4.0-rc.1 acceptance plan](0.4.0_RC1_ACCEPTANCE_PLAN.md). Configure TLS only through the documented [production procedure](CUSTOMER_DEPLOYMENT_GUIDE.md).
