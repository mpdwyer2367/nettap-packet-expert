# macOS deployment and acceptance

## Supported release-candidate path

- macOS on Apple silicon (`arm64`) or Intel (`x86_64`)
- Docker Desktop with Docker Compose v2
- 16 GB host memory recommended; 8 GB is a constrained evaluation floor
- 15 GB free disk minimum
- Browser access to `http://127.0.0.1:3001`

The default deployment runs both Ollama and Open WebUI in Linux containers. It is portable and CPU-compatible on Apple silicon, but Docker Desktop does not expose Apple's Metal GPU to the Ollama container. Performance validation must therefore record host architecture, memory, Docker resources, model load time, first-token time, and sustained token rate. Native Ollama is a future acceleration profile, not part of this release candidate.

`ollama run` is a terminal client and does not launch Open WebUI. The supported graphical deployment is started by `scripts/start-macos.sh` and opened at `http://127.0.0.1:3001`.

## Install and run

1. Install and start Docker Desktop.
2. Clone the repository and open Terminal in it.
3. Run `./scripts/start-macos.sh`.
4. Open `http://127.0.0.1:3001`.
5. Create the first account. Open WebUI assigns the first account the administrator role; later accounts remain pending until approved.
6. Select `nettap-packet-expert:0.1.0-rc.7` if it is not already selected.

The first run downloads multiple container images and the approximately 4.7 GB quantized base model. Completion time depends on network and storage performance.

## Automated test

Run `./tests/macos-e2e.sh`. It verifies source controls, model creation, identity, a controlled inference, UI health, and persistence across service restart. It writes a timestamped report under `reports/`.

Complete these manual checks before public release:

- First user becomes admin and can sign out and back in.
- The custom model is selected and returns a response.
- Four broad starter prompts appear.
- The UI still identifies itself as Open WebUI; the project must not remove Open WebUI branding without permission or an applicable license.
- The service is bound only to loopback.
- No real customer packet capture, credential, secret, or personal data is present.

## Stop and update

- Stop services without deleting data: `./scripts/stop.sh`
- Show status: `./scripts/status.sh`
- Rebuild the custom model after reviewing `model/Modelfile`: `./scripts/update-model.sh --confirm`

Never run `docker compose down -v` unless permanent deletion of all local users, chats, configuration, and downloaded models is intended.

## Troubleshooting and recovery

- If Docker cannot be reached, start Docker Desktop and wait until its engine is ready.
- If port 3001 is occupied, change `WEB_PORT` in `.env` and keep `BIND_ADDRESS=127.0.0.1`.
- Inspect failures with `docker compose --env-file .env -f compose.yaml ps` and `docker compose --env-file .env -f compose.yaml logs --tail 200 open-webui ollama`.
- If model creation stops, confirm free space, restart Docker Desktop, and rerun the launcher; completed downloads are reused.

Do not disable endpoint security or organizational controls to work around deployment errors. Before upgrading, back up the Docker volumes and review `.env.example`, `compose.yaml`, and `model/Modelfile`. Review Open WebUI database compatibility before downgrading.
