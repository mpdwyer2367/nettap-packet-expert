# RC7 release acceptance plan

Use the exact same Git commit and package on macOS and Windows/WSL2. Start with empty candidate volumes; preserve older production volumes for rollback.

## Automated gates

1. Static checks, unit tests and production configuration checks pass.
2. Controlled initialization verifies image references, Qwen base ID, `nettap-ai:0.3.0-rc.7`, embedding revision and provisioning fingerprint.
3. Normal runtime has no registry egress; Ollama and evidence processing publish no host ports.
4. One Open WebUI is reachable at port 3100 and one assistant is pinned.
5. All three knowledge collections, the combined Skill and the managed Filter are installed.
6. Offline RAG retrieval and controlled model inference pass.
7. Restart preserves accounts, model, knowledge and provisioning identity.
8. Backup checksums, non-overwriting restore and rollback pass.

## Manual gates

1. Generated administrator sign-in, password change, old-password rejection and finalization.
2. Browser rendering and intuitive suggestions in the combined UI.
3. Network design, configuration-safety, troubleshooting and no-live-data behavior.
4. Authorized classic PCAP, log and normalized-flow attachments produce professional cited assessments with quality limitations.
5. Unsupported, malformed, oversized and adversarial files fail safely.
6. Ports 3000, 3001 and 3200 are absent.

## Release evidence

- exact commit/tree, package SHA-256 and signed artifacts;
- image digests, model IDs and embedding aggregate;
- macOS and Windows/WSL2 reports;
- SBOM and vulnerability disposition;
- penetration-test disposition;
- license/third-party/legal approval;
- support readiness and commercial approval;
- completed release-acceptance record with named approvers.

RC7 remains a candidate until every applicable gate is evidenced and approved.
