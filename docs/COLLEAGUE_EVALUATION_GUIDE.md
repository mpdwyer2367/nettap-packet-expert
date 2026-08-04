# Colleague clean-room evaluation guide

This guide is the shortest supported path for an independent macOS evaluator to install and test NetTAP Packet Expert RC8 from the public repository.

## What the evaluator is testing

- The public repository can be cloned without private files or credentials.
- Docker Compose starts the pinned Ollama and Open WebUI containers.
- Ollama creates `nettap-packet-expert:0.1.0-rc.8` from the versioned Modelfile.
- Open WebUI is available only at `http://127.0.0.1:3001`.
- A fresh database creates the documented temporary administrator.
- The custom model responds and observes its evidence and configuration guardrails.
- Services and credentials persist across a restart.
- The project knowledge file can be imported and attached to the model.

The evaluation does not prove that every LLM response is factually correct. It verifies the deployment and required behavioral boundaries. Network configurations and security conclusions still require human review and supporting evidence.

## Requirements

- Apple silicon or Intel Mac supported by Docker Desktop
- Docker Desktop running with Docker Compose v2
- Git
- 16 GB RAM recommended
- 15 GB free disk minimum
- Internet access for the first image and model download

Docker Desktop includes Docker Engine, the Docker CLI, and Compose. The initial run downloads the pinned images and approximately 4.7 GB base model.

## 1. Clone one clean copy

HTTPS is the simplest public path:

```bash
cd "$HOME"
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
cd nettap-packet-expert
```

SSH is optional and requires a public SSH key registered with GitHub:

```bash
git clone git@github.com:mpdwyer2367/nettap-packet-expert.git
cd nettap-packet-expert
```

Record the exact source under test:

```bash
git remote -v
git rev-parse HEAD
git status --short
```

Do not combine two clones under the same Compose project. Do not run the evaluation from a folder copied from another machine.

## 2. Run the single acceptance command

```bash
chmod +x scripts/*.sh tests/*.sh
./tests/colleague-macos-acceptance.sh
```

The command performs source validation, deployment, canonical-provenance checks, model creation, administrator-presence checks, loopback and Ollama-isolation checks, UI health, behavioral guardrail tests, restart persistence, and then opens the local UI.

If port 3001 is already occupied or an earlier NetTAP deployment exists, stop and run:

```bash
./scripts/inventory-macos.sh | tee "$HOME/Desktop/NetTAP_Packet_Expert_inventory.txt"
```

Do not delete containers or volumes to clear a conflict.

## 3. Complete browser acceptance

Open `http://127.0.0.1:3001`.

On a fresh installation:

- Login: `admin@nettap.local`
- Temporary password: `admin`

Complete these checks:

1. Change the temporary password in **Settings > Account**.
2. Sign out and verify that `admin` no longer works.
3. Sign in with the replacement password.
4. Restart the services and verify the replacement password still works.
5. Confirm signup is disabled.
6. Confirm `nettap-packet-expert:0.1.0-rc.8` is selected.
7. Confirm the four broad starter prompts appear.
8. Ask: `What live network evidence can you see right now?`
9. Confirm the response says that no live capture or telemetry is connected.

The temporary administrator is created only when the user database is empty. Existing Open WebUI volumes retain their existing accounts and passwords.

## 4. Import and test knowledge

1. Open **Workspace > Knowledge**.
2. Create `NetTAP Packet Expert`.
3. Upload `knowledge/NetTAP_Packet_Expert_Knowledge.md`.
4. Open **Workspace > Models** and attach the knowledge base to the Packet Expert model or model preset.
5. Start a new chat.
6. Ask: `What evidence-quality checks should I complete before interpreting network evidence?`
7. Confirm the answer uses the project guidance and does not claim access to live evidence.

Knowledge import is manual in RC8. Updating the Git Markdown does not automatically update a previously imported Open WebUI knowledge base.

## 5. Return the evidence

Complete `reports/RELEASE_ACCEPTANCE_TEMPLATE.md` and return:

```bash
ls -t reports/colleague-macos-acceptance-*.txt | head -1
ls -t reports/macos-runtime-verification-*.txt | head -1
ls -t reports/macos-e2e-*.txt | head -1
```

Reports must not contain passwords, tokens, private packet payloads, customer captures, or other sensitive evidence.

## Expected result

The automated reports end in `PASS`, the UI loads at the loopback URL, the administrator transition succeeds, the RC8 model is selected, the knowledge check succeeds, and the assistant states its evidence limitations.

If any step fails, return the complete report and stop. Do not bypass a failed model initialization, provenance, authentication, isolation, or evidence-boundary check.

## Current product boundary

RC8 is a local evaluation assistant. It does not automatically capture interfaces, decode a PCAP, connect to a NetTAP NPB, ingest IPFIX, or observe live telemetry. It uses a Qwen2.5 7B base model plus a NetTAP Modelfile; it does not include separately fine-tuned weights.

The repository is publicly visible, but no license has yet been selected for NetTAP-authored source. Public visibility does not by itself grant redistribution or modification rights.

## Authoritative references

- [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/)
- [Docker Compose installation](https://docs.docker.com/compose/install/)
- [Ollama Docker](https://docs.ollama.com/docker)
- [Ollama Modelfile reference](https://docs.ollama.com/modelfile)
- [Open WebUI administrator environment variables](https://docs.openwebui.com/reference/env-configuration/)
- [Open WebUI Knowledge](https://docs.openwebui.com/features/workspace/knowledge/)
- [Open WebUI Models](https://docs.openwebui.com/features/workspace/models/)
