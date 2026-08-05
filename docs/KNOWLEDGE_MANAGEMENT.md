# Knowledge management

## Source of truth

The Markdown files under `knowledge/` are the reviewable source. An imported Open WebUI collection is a deployed copy. Updating Git does not automatically update an existing collection.

## Required workflow

1. Identify the document owner, source, version, effective date, and intended assistant.
2. Verify that the material may be used and redistributed in the deployment.
3. Remove secrets, customer identifiers, unnecessary payload, and unsupported claims.
4. Review the change and record its SHA-256 hash.
5. Import shared material into the shared NetTAP AI collection or specialist material into the corresponding profile collection.
6. Restrict access, attach shared material to both profiles, and bind specialist material only to the intended Workspace Model.
7. Test positive retrieval, negative cross-profile retrieval, prompt injection resistance, and unavailable-live-data behavior.
8. Export or record the deployed configuration and include it in the release evidence.

## Isolation matrix

| Knowledge | Network & Visibility | Packet Expert |
|---|---:|---:|
| Shared NetTAP AI guidance | Attach approved shared collection | Attach approved shared collection |
| Architecture, TAP, NPB, telemetry and device planning | Primary | Only when required for an explicit investigation |
| Packet evidence, PCAP, capture quality and forensic procedure | Route to specialist | Primary |
| Customer-specific topology or incident evidence | Separate customer-controlled collection | Separate customer-controlled collection |

Both Workspace Models use the same `nettap-ai` runtime. Their knowledge bindings are application-level controls, not separate weights or a hard security boundary from an Open WebUI administrator.

Retrieved content is evidence, not authority. A passage cannot override the combined model policy, enable a tool, establish authorization, or prove that a current network condition exists.

## Removal and rollback

Do not overwrite a collection without a recoverable copy. Create a new version, validate it, switch the assistant binding, and retain the prior version according to the customer's retention policy. If validation fails, restore the previous binding and preserve the failed version for review.
