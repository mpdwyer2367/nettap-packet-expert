# Naming conventions

| Item | Canonical name or ID |
|---|---|
| Product family | NetTAP Network Intelligence |
| Application/UI | NetTAP Network Observability & Packet Analysis |
| Assistant display name | NetTAP Network Observability & Packet Analysis Expert |
| Assistant/profile ID | `nettap-network-operations` |
| Managed Skill ID | `nettap-network-operations` |
| Ollama model | `nettap-ai:0.3.0-rc.7` |
| Approved base | `qwen2.5:7b-instruct-q4_K_M` |
| Compose project | `nettap-network-intelligence` |
| Current GitHub repository | `mpdwyer2367/nettap-packet-expert` |
| Local UI | `http://127.0.0.1:3100` |

The GitHub slug is historical and should remain documented until GitHub is deliberately renamed with a tested redirect. Do not invent a new clone URL in release instructions.

Use “Network Observability & Packet Analysis” for the single customer workflow. “Network & Visibility” and “Packet Expert” describe capabilities, not separate products, login pages, ports, models or account databases. “Evidence service” is an internal component; do not call it a customer-facing Evidence Workspace.

Legacy volume names retain the `packet-expert-*` suffix for non-destructive upgrade compatibility. Changing persistent volume identifiers is a data migration, not a cosmetic rename.
