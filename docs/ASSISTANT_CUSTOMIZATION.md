# Assistant customization

## Configuration layers

| Layer | Network & Visibility | Packet Expert | Update method |
|---|---|---|---|
| Base weights | Shared Qwen2.5 7B | Shared Qwen2.5 7B | Approved suite release only |
| Ollama policy | `model/network-visibility.Modelfile` | `model/packet-expert.Modelfile` | Reviewed source change and model rebuild |
| Manifest | `assistants/network-visibility/assistant.yaml` | `assistants/packet-expert/assistant.yaml` | Reviewed source change |
| Knowledge source | Network and visibility Markdown | Packet evidence Markdown | Version, review, hash, import, validate |
| Starting experience | Port 3000 launcher | Port 3001 launcher | Reviewed HTML and Caddy route change |
| Open WebUI preset | Optional curated Workspace Model | Optional curated Workspace Model | Administrator import or controlled UI change |
| Tools and skills | Separate allowlist | Separate allowlist | Security review and negative permission tests |

## Non-negotiable separation

- Never replace both assistant prompts with one generic system prompt.
- Do not attach Packet Expert knowledge or tools to Network & Visibility by default.
- Do not attach broad network configuration tools to Packet Expert merely because the base model is shared.
- Keep global Open WebUI suggestions generic. Assistant-specific starting points belong to each launcher or its curated Workspace Model.
- Keep live-data claims disabled until a connector supplies current, validated evidence.

## Workspace Model setup

Open WebUI Workspace Models can add per-assistant avatars, descriptions, prompt suggestions, knowledge, skills, tools, parameters, tags, and access controls. Use the matching Ollama assistant model as the base:

### Network & Visibility

- Name: `NetTAP Network & Visibility`
- ID: `nettap-network-visibility`
- Base: `nettap-network-visibility:0.3.0-rc.1`
- Knowledge: only the approved Network & Visibility collection
- Tools: none by default
- Suggestions: Start here; Design or configure; Connect visibility and data

### Packet Expert

- Name: `NetTAP Packet Expert`
- ID: `nettap-packet-expert`
- Base: `nettap-packet-expert:0.3.0-rc.1`
- Knowledge: only the approved Packet Expert collection
- Tools: none by default
- Suggestions: Start an investigation; Understand my evidence; Plan a capture

Export the reviewed Workspace Models as JSON from the pinned Open WebUI release and store the export as protected release evidence before customer deployment. The repository intentionally does not inject unverified records into Open WebUI's SQLite database or depend on undocumented database fields.

## Change acceptance

Every assistant change requires:

1. A manifest version update.
2. Prompt and knowledge diffs reviewed by a domain owner.
3. Static tests.
4. Behavioral tests for the changed assistant.
5. Negative tests against prompt injection, invented live data, cross-assistant knowledge, and unauthorized tools.
6. A target-host browser test.
7. Backup and rollback confirmation.

A shared base-model upgrade is a product behavior change, not a storage-only update. Evaluate it in a separate release and do not combine it with repository or database migration.
