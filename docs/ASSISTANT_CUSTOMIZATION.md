# Assistant customization

## Configuration layers

| Layer | Network & Visibility | Packet Expert | Update method |
|---|---|---|---|
| Base weights | Shared Qwen2.5 7B | Shared Qwen2.5 7B | Approved suite release only |
| Ollama policy | `model/nettap-ai.Modelfile` | Same combined model | Reviewed source change and one model rebuild |
| Manifest | `assistants/network-visibility/assistant.yaml` | `assistants/packet-expert/assistant.yaml` | Reviewed source change |
| Shared knowledge | `knowledge/NetTAP_AI_Knowledge.md` | Same reviewed shared collection | Version, review, hash, import, validate |
| Specialist knowledge | Network and visibility Markdown | Packet evidence Markdown | Version, review, hash, import, validate |
| Starting experience | Port 3000 launcher | Port 3001 launcher | Reviewed HTML and Caddy route change |
| Open WebUI preset | Optional curated Workspace Model | Optional curated Workspace Model | Administrator import or controlled UI change |
| Tools and skills | Separate allowlist | Separate allowlist | Security review and negative permission tests |

## Non-negotiable profile separation

- Keep the combined safety and evidence policy in `model/nettap-ai.Modelfile`; do not weaken it in a profile prompt.
- Do not attach Packet Expert knowledge or tools to Network & Visibility by default.
- Do not attach broad network configuration tools to Packet Expert merely because the base model is shared.
- Keep global Open WebUI suggestions generic. Assistant-specific starting points belong to each launcher or its curated Workspace Model.
- Keep live-data claims disabled until a connector supplies current, validated evidence.

## Workspace Model setup

Open WebUI Workspace Models can add per-profile avatars, descriptions, prompt suggestions, knowledge, skills, tools, parameters, tags, and access controls. Both presets must use the same combined Ollama model as their base. A Workspace Model is a lightweight application preset; it does not duplicate the model weights.

### Network & Visibility

- Name: `NetTAP Network & Visibility`
- ID: `nettap-network-visibility`
- Base: `nettap-ai:0.3.0-rc.2`
- System prompt addition: begin in Network & Visibility mode and keep initial guidance broad
- Knowledge: approved shared NetTAP AI collection plus Network & Visibility collection
- Tools: none by default
- Suggestions: Start here; Design or configure; Connect visibility and data

### Packet Expert

- Name: `NetTAP Packet Expert`
- ID: `nettap-packet-expert`
- Base: `nettap-ai:0.3.0-rc.2`
- System prompt addition: begin in Packet Expert mode and use evidence-first analysis
- Knowledge: approved shared NetTAP AI collection plus Packet Expert collection
- Tools: none by default
- Suggestions: Start an investigation; Understand my evidence; Plan a capture

The unwrapped `nettap-ai:0.3.0-rc.2` entry may be used for authorized unified workflows spanning architecture, acquisition, packet evidence, and remediation planning.

Export the reviewed Workspace Models as JSON from the pinned Open WebUI release and store the export as protected release evidence before customer deployment. The repository intentionally does not inject unverified records into Open WebUI's SQLite database or depend on undocumented database fields. Until those exports are created and validated against the pinned Open WebUI release, the port 3000 and 3001 launchers provide mode-specific starts, but do not themselves create persistent knowledge or tool bindings.

## Change acceptance

Every assistant change requires:

1. A combined model or profile-manifest version update, as applicable.
2. Prompt and knowledge diffs reviewed by a domain owner.
3. Static tests.
4. Behavioral tests for the combined model and changed profile.
5. Negative tests against prompt injection, invented live data, cross-profile knowledge, and unauthorized tools.
6. A target-host browser test.
7. Backup and rollback confirmation.

A shared base-model upgrade is a product behavior change, not a storage-only update. Evaluate it in a separate release and do not combine it with repository or database migration.
