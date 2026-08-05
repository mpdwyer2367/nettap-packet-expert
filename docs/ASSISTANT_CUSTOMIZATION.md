# Assistant customization

## Configuration layers

| Layer | Network & Visibility | Packet Expert | Update method |
|---|---|---|---|
| Base weights | Shared Qwen2.5 7B | Shared Qwen2.5 7B | Approved suite release only |
| Ollama policy | `model/nettap-ai.Modelfile` | Same combined model | Reviewed source change and one model rebuild |
| Manifest | `assistants/network-visibility/assistant.yaml` | `assistants/packet-expert/assistant.yaml` | Reviewed source change |
| Shared knowledge | `knowledge/NetTAP_AI_Knowledge.md` | Same reviewed shared collection | Version, review, hash, automatic reconciliation |
| Specialist knowledge | Network and visibility Markdown | Packet evidence Markdown | Version, review, hash, automatic reconciliation |
| Starting experience | Port 3000 launcher | Port 3001 launcher | Reviewed HTML and Caddy route change |
| Open WebUI preset | Managed Workspace Model | Managed Workspace Model | Supported Open WebUI API reconciliation |
| Tools and skills | Separate allowlist | Separate allowlist | Security review and negative permission tests |

## Non-negotiable profile separation

- Keep the combined safety and evidence policy in `model/nettap-ai.Modelfile`; do not weaken it in a profile prompt.
- Do not attach Packet Expert knowledge or tools to Network & Visibility by default.
- Do not attach broad network configuration tools to Packet Expert merely because the base model is shared.
- Keep global Open WebUI suggestions generic. Assistant-specific starting points belong to each launcher or its curated Workspace Model.
- Keep live-data claims disabled until a connector supplies current, validated evidence.

## Automatic Workspace Model setup

The `assistant-provisioner` creates or updates both profiles through the pinned Open WebUI HTTP APIs. It preserves existing access grants when adopting a recognized NetTAP RC1/RC2 profile, attaches only the manifest-approved collections, disables optional tools, selects legacy function calling for deterministic attached-knowledge injection in Open WebUI v0.11.0, pins both profiles, and makes Network & Visibility the default. A Workspace Model is a lightweight application preset; it does not duplicate model weights.

### Network & Visibility

- Name: `NetTAP Network & Visibility`
- ID: `nettap-network-visibility`
- Base: `nettap-ai:0.3.0-rc.3`
- System prompt addition: begin in Network & Visibility mode and keep initial guidance broad
- Knowledge: approved shared NetTAP AI collection plus Network & Visibility collection
- Tools: none by default
- Suggestions: Start here; Design or configure; Connect visibility and data

### Packet Expert

- Name: `NetTAP Packet Expert`
- ID: `nettap-packet-expert`
- Base: `nettap-ai:0.3.0-rc.3`
- System prompt addition: begin in Packet Expert mode and use evidence-first analysis
- Knowledge: approved shared NetTAP AI collection plus Packet Expert collection
- Tools: none by default
- Suggestions: Start an investigation; Understand my evidence; Plan data collection

The unwrapped `nettap-ai:0.3.0-rc.3` entry may be used for authorized unified workflows spanning architecture, acquisition, packet evidence, and remediation planning.

The source of truth is `provisioning/open-webui.json` plus its referenced prompt and knowledge files. Installation calculates a fingerprint, synchronously uploads and embeds each managed file, performs a retrieval proof, reconciles both Workspace Models, and records `/app/backend/data/nettap-provisioning-state.json`. The provisioner refuses to overwrite an unmanaged collection with a managed name, an unrecognized Workspace Model, or unmanaged files inside a managed collection.

After changing a reviewed source, run `./scripts/nettap-ai provision-assistants --confirm`. If the bootstrap credential has been retired, the command requests the current administrator password without storing it. Back up Open WebUI before a production change. Customer-created collections remain outside this managed lifecycle.

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
