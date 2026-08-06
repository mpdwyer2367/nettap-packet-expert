# NetTAP Network Intelligence 0.3.0-rc.5 acceptance plan

RC5 is the unified product-experience and one-model candidate. It is eligible
for controlled evaluation only until the exact signed package passes every gate
below on both supported host paths.

## Exact candidate identity

- Release: `0.3.0-rc.5`
- Ollama model: `nettap-ai:0.3.0-rc.5`
- Base: `qwen2.5:7b-instruct-q4_K_M`
- Expected base ID: `845dbda0ea48`
- Open WebUI profiles: `nettap-network-visibility` and `nettap-packet-expert`
- Embedding revision: `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`

## Required platform acceptance

Run `tests/clean-package-acceptance.sh` from empty, uniquely named Docker
volumes on macOS and Windows/WSL2 using the same archive, commit, tree, checksum,
signature, and public key. Each result must prove:

1. One-command installation and generated administrator credential handling.
2. Ports 3000, 3001, 3100, and 3200 work as documented; both welcome pages
   show application readiness, authentication guidance, guided starts, and the
   correct cross-experience links.
3. Both canonical Open WebUI profile names select `nettap-ai:0.3.0-rc.5`.
4. Offline RAG imports, indexes, retrieves, and survives restart without egress.
5. The Qwen base is downloaded once and both profiles share one NetTAP model.
6. Older NetTAP container tags are absent after successful initialization.
7. Normalized PCAP, log, and flow fixtures plus all behavioral tests pass.
8. Backup, restore, failed-update recovery, and rollback from the protected
   pre-upgrade backup pass.
9. An unauthenticated user reaches the Open WebUI sign-in flow without the
   welcome page receiving credentials, then returns to the intended profile.
10. One authenticated session can switch between both experiences; signup is
    disabled, generated-password replacement is recorded, and old-password
    rejection is manually verified.

Compare the two platform records with `tests/compare-platform-acceptance.sh`.

## Independent release gates

- Exact-image SBOM and accepted vulnerability disposition
- Package checksums, provenance, signatures, and signature verification
- Independent penetration-test disposition
- Legal, third-party, trademark, privacy, and commercial approval
- Support readiness, lifecycle, recovery, and update policy approval
- Authorized release acceptance bound to the exact package

Source CI or a successful run on only one host cannot grant production or
commercial approval.
