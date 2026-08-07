# Integrated evidence ingestion

There is no separate Evidence Workspace page or host port in RC8. Evidence ingestion is a private application service used from the authenticated Open WebUI chat.

## User workflow

1. Open the combined assistant at port 3100.
2. Attach an authorized supported file.
3. State the objective, environment and desired output.
4. Review the response for source state, evidence IDs/hashes, quality warnings, observations, hypotheses, limitations and next actions.

Evidence attachments are `.pcap`, `.json`, `.jsonl`, `.ndjson`, `.log` and `.txt`. Classic PCAP supports Ethernet and raw-IP link types. PCAPNG and native binary flow telemetry require approved external normalization. The service enforces configured upload and record limits.

The same chat control accepts `.png`, `.jpg`, `.jpeg` and `.webp` network images. The Filter validates file signatures and applies a four-image, 10 MB-per-image limit before sending pixels to the local multimodal model. Images are not parsed or retained by the evidence case service beyond normal Open WebUI upload storage; remove sensitive uploads according to the customer retention policy.

## Security properties

- The evidence service is reachable only over the private Docker backend.
- Its bearer token is generated locally and is not a user-facing login.
- The managed Filter is source-controlled, checksummed and provisioned by an authenticated administrator.
- Original evidence is retained in a dedicated volume; only minimized context reaches the model.
- The parser does not decrypt traffic, execute payloads, call threat-intelligence services or claim live telemetry.
- Conclusions remain evidence-supported indicators or hypotheses unless sufficient evidence establishes a stronger finding.

## Administrator checks

```bash
docker compose --env-file .env -f compose.yaml -f compose.local.yaml ps evidence-service
docker compose --env-file .env -f compose.yaml -f compose.local.yaml logs --tail=200 evidence-service
docker compose --env-file .env -f compose.yaml -f compose.local.yaml exec -T evidence-service \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8081/health').read().decode())"
```

Do not publish port 8081/3200 or expose its API directly to users. Back up and restore the evidence volume with the product scripts so hashes, case records and originals remain together.
