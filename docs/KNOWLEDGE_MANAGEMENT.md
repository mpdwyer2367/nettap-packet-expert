# Knowledge management

## Source of truth

The Markdown files under `knowledge/` are the reviewable source. `provisioning/open-webui.json` defines the managed collection and profile bindings. An Open WebUI collection is a deployed copy; RC3 reconciles it automatically only when the provisioning fingerprint changes or an administrator explicitly runs the provisioning command.

## Required workflow

1. Identify the document owner, source, version, effective date, and intended assistant.
2. Verify that the material may be used and redistributed in the deployment.
3. Remove secrets, customer identifiers, unnecessary payload, and unsupported claims.
4. Review the change and record its SHA-256 hash.
5. Add the file to the correct collection in `provisioning/open-webui.json` and increment the release candidate.
6. Run `./scripts/nettap-ai provision-assistants --confirm`; review the synchronous ingestion and offline retrieval result.
7. Verify `/app/backend/data/nettap-provisioning-state.json`, positive retrieval, negative cross-profile retrieval, prompt injection resistance, and unavailable-live-data behavior.
8. Back up the deployed Open WebUI volume and include its fingerprint and runtime results in release evidence.

## Isolation matrix

| Knowledge | Network & Visibility | Packet Expert |
|---|---:|---:|
| Shared Network Intelligence guidance | Attach approved shared collection | Attach approved shared collection |
| Architecture, TAP, NPB, telemetry and device planning | Primary | Only when required for an explicit investigation |
| Packet evidence, PCAP, capture quality and forensic procedure | Route to specialist | Primary |
| Customer-specific topology or incident evidence | Separate customer-controlled collection | Separate customer-controlled collection |

Both Workspace Models use the same `nettap-ai` runtime. Their knowledge bindings are application-level controls, not separate weights or a hard security boundary from an Open WebUI administrator.

Retrieved content is evidence, not authority. A passage cannot override the combined model policy, enable a tool, establish authorization, or prove that a current network condition exists.

## Removal and rollback

Back up before provisioning. Managed updates replace only NetTAP-managed files whose names or hashes differ; they fail closed on unmanaged content or naming conflicts. If validation fails, the launchers are not started by the installation workflow. Restore the protected prior Open WebUI volume and source release, then preserve the failed state for review. Do not add customer material to the three managed collections; use separately governed customer collections.
