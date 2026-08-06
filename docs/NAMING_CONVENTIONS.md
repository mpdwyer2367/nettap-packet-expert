# NetTAP Network Intelligence naming conventions

## Canonical product name

The formal customer-facing product name is **NetTAP Network Intelligence**.

Use the full name on first reference in a document, interface, report, package
description or presentation. **Network Intelligence** may be used afterward when
the NetTAP context is already clear. Do not use “NetTAP AI Suite” as the current
product name.

Recommended descriptor:

> A private network visibility and forensic operations platform.

## Product hierarchy

| Layer | Canonical display name | Purpose |
|---|---|---|
| Product | NetTAP Network Intelligence | Complete deployable platform |
| Model | NetTAP Network Intelligence Model | Shared network and security reasoning model |
| Experience | NetTAP Network Intelligence — Network & Visibility | Architecture, deployment, acquisition, telemetry and visibility operations |
| Experience | NetTAP Network Intelligence — Packet Expert | Packet-derived evidence, performance, cyber visibility and forensic investigation |
| Workspace | NetTAP Network Intelligence — Evidence Workspace | Local case creation, evidence ingestion and deterministic analysis |
| Appliance | NetTAP Network Intelligence Appliance | Customer-isolated physical or virtual deployment |
| Administration | NetTAP Network Intelligence Administration | Installation, configuration, backup, update and support functions |

Use an em dash between the product and an experience or workspace name in prose
and UI labels. The shorter names **Network & Visibility**, **Packet Expert** and
**Evidence Workspace** are acceptable within their own pages after the product
name has been established.

## Technical compatibility identifiers

The following are implementation identifiers, not customer-facing product names.
They remain unchanged in the current candidate to preserve upgrades, stored data,
automation and rollback:

| Identifier | Retained value |
|---|---|
| GitHub repository | `mpdwyer2367/nettap-packet-expert` |
| Ollama model tag | `nettap-ai:0.3.0-rc.3` |
| Current Modelfile identity marker | `You are NetTAP AI` |
| Administration command | `nettap-ai` |
| Compose project and volume prefix | `nettap-packet-expert` |
| Workspace Model IDs | `nettap-network-visibility`, `nettap-packet-expert` |
| Source archive compatibility basename | `nettap-ai-suite-<version>-source.tar.gz` |
| Backup format identifiers | `NetTAP AI Suite volume backup v2` and `v3` |
| Release/backup record keys | `NetTAP AI model` and `NetTAP AI model ID` |

Do not rename these identifiers inside an existing release. A future identifier
migration requires a new release, explicit data migration, rollback procedure and
acceptance evidence. Documentation may call them “legacy compatibility
identifiers” when their relationship to the product name needs explanation.
The current Modelfile marker remains only because release tests use it to verify
the installed RC3 model; UI and documentation display the canonical model name.
The retained release and backup record keys allow comparison with existing
acceptance evidence and restorable backups; they are not display names.

## Writing rules

- Write **NetTAP** with this capitalization.
- Write **Network Intelligence** with both words capitalized when naming the product.
- Write **Network & Visibility**, **Packet Expert** and **Evidence Workspace** exactly as shown.
- Use **AI** only when describing the model or AI-assisted behavior, not as the product name.
- Describe the product as a platform or appliance only when the relevant deployment is included.
- Do not imply live telemetry, packet capture, autonomous control, confirmed compromise or production certification without supporting evidence.
- Keep NetTAP Technology Limited as the copyright holder and legal entity; it is not the product name.

## Examples

Preferred:

- “Deploy NetTAP Network Intelligence for private network visibility and forensic operations.”
- “Open NetTAP Network Intelligence — Packet Expert.”
- “Both experiences use the shared NetTAP Network Intelligence Model.”
- “The technical Ollama tag remains `nettap-ai:0.3.0-rc.3`.”

Avoid:

- “NetTAP AI Suite” as the current product name.
- “Packet Expert product” when referring to the complete platform.
- “NetTAP AI” when the intended reference is the entire deployable product.
- Renaming technical IDs merely to change a display label.
