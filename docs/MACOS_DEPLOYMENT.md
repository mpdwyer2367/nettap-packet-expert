# macOS deployment and acceptance

## Supported release-candidate path

- macOS on Apple silicon (`arm64`) or Intel (`x86_64`)
- Docker Desktop with Docker Compose v2
- 16 GB host memory recommended; 8 GB is a constrained evaluation floor
- 15 GB free disk minimum
- Browser access to `http://127.0.0.1:3001`

The default deployment runs both Ollama and Open WebUI in Linux containers. It is portable and CPU-compatible on Apple silicon, but Docker Desktop does not expose Apple's Metal GPU to the Ollama container. Performance validation must therefore record host architecture, memory, Docker resources, model load time, first-token time, and sustained token rate. Native Ollama is a future acceleration profile, not part of this release candidate.

## Install and run

1. Install and start Docker Desktop.
2. Clone the repository and open Terminal in it.
3. Run `./scripts/start-macos.sh`.
4. Open `http://127.0.0.1:3001`.
5. On a fresh data volume, sign in with `admin@nettap.local` and temporary password `admin`.
6. Open **Settings > Account** and replace the temporary password with a unique 12–72 character password containing uppercase, lowercase, number, and symbol.
7. Sign out, confirm the old password fails, and sign in with the replacement password.
8. Select `nettap-packet-expert:0.1.0-rc.8` if it is not already selected.

Existing Open WebUI volumes retain their existing accounts and passwords. Bootstrap credentials do not overwrite an existing administrator. See [Administrator bootstrap and account access](AUTHENTICATION.md).

The first run downloads multiple container images and the approximately 4.7 GB quantized base model. Completion time depends on network and storage performance.

## Automated test

Run `./tests/macos-e2e.sh`. It verifies source controls, model creation, identity, a controlled inference, UI health, and persistence across service restart. It writes a timestamped report under `reports/`.

Complete these manual checks before public release:

- Fresh-volume bootstrap administrator exists and has the admin role.
- Temporary password is replaced; the old password fails and the new password survives restart.
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
