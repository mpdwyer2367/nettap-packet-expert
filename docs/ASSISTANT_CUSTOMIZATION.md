# Managed assistant customization

The release provisions one assistant, `nettap-network-operations`, over one `nettap-ai` model. Capability separation is achieved through reviewed knowledge sections and one combined Skill—not duplicate model weights or separate login pages.

| Layer | Reviewed source |
|---|---|
| Core safety/evidence policy | `assistants/shared/core-policy.md` |
| Product prompt | `assistants/nettap-operations/system-prompt.md` |
| Skill | `skills/nettap-network-operations/SKILL.md` |
| Knowledge | `knowledge/*.md` |
| Attachment Filter | `functions/nettap_evidence_ingestion.py` |
| Provisioning manifest | `provisioning/open-webui.json` |
| Source pins | `provisioning/knowledge-sources.sha256` |

To change behavior, edit the source, review safety and data-boundary effects, update the matching checksum, bump the release identity, run unit/static/behavioral tests and execute `./scripts/nettap-ai provision-assistants --confirm` on an acceptance deployment. Never edit only the live Workspace Model and call that a release; the source manifest must remain authoritative.

The initial suggestions must remain broad: getting started, troubleshooting, attached evidence and visibility improvement. Follow-up questions should use known context, ask one important question at a time and include “Help me decide” when appropriate.
