# NetTAP Network Intelligence 0.3.0-rc.6 acceptance plan

RC6 is the validated-evidence integration candidate. It is eligible for
controlled colleague evaluation only; it is not production-certified or
approved for commercial distribution.

## Candidate identity

- Release: `0.3.0-rc.6`
- Ollama model: `nettap-ai:0.3.0-rc.6`
- One shared Qwen2.5 7B weight set
- Open WebUI profiles: `nettap-network-visibility` and `nettap-packet-expert`
- Evidence tool binding: `server:nettap_evidence`, Packet Expert only

The macOS and Windows/WSL2 acceptance runs must use the exact same signed
archive, Git commit, tree, image digests, model identity, and knowledge-file
hashes.

## Automated source gates

1. Static, manifest, documentation-link, Python unit, shell syntax, archive,
   provisioning, and production-configuration checks pass.
2. The OpenAPI contract exposes only case listing and minimized case context;
   it does not expose upload, delete, raw evidence, secrets, or device actions.
3. Provisioning grants the evidence tool only to the administrator and binds it
   only to Packet Expert. Network & Visibility has no evidence tool binding.
4. The Evidence Workspace rejects unsupported extensions, oversized inputs,
   PCAPNG presented as classic PCAP, invalid schemas, and hash mismatches.
5. Provisioning state contains the tool identity and fingerprint but no bearer
   token.

## Clean runtime acceptance on each platform

1. Begin with empty candidate volumes and no prior NetTAP containers.
2. Complete one-command installation with generated administrator credentials,
   mandatory password change, and finalized administrator state.
3. Verify ports 3000, 3001, 3100, and 3200 and all health endpoints.
4. Verify a single current NetTAP Ollama tag and that both assistants use it.
5. Verify offline RAG after bootstrap egress is removed.
6. In Evidence Workspace, review the Assistant setup page, create a case, and
   ingest supported classic PCAP, syslog, normalized flow, cloud-flow, and JSON
   samples with provenance and quality metadata.
7. Run deterministic analysis, launch Packet Expert with the case UUID, and
   verify that the model retrieves only minimized, provenance-linked context.
8. Confirm raw payloads, packet bytes, uploaded files, and the evidence token do
   not appear in chat prompts, tool responses, provisioning state, or logs.
9. Execute all fourteen behavioral tests and review evidence-supported wording,
   limitations, validation steps, and rollback guidance.
10. Test restart, backup, restore, update failure recovery, and rollback.

## Release evidence still required

- SBOM and vulnerability-policy disposition
- Package and image checksums
- Signed package and provenance verification
- Independent penetration-test disposition
- Legal, support, and commercial approvals
- Authorized completed release-acceptance record

Production or commercial approval is denied until every applicable gate passes
for the immutable RC6 candidate.
