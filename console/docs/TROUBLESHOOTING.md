# NetTAP Deployment Troubleshooting

Diagnose the pipeline in order: dependency, interface, permission, capture, decoding, DNS/TLS, authentication, authorization, backend, and application evidence.

## Failure matrix

| Symptom | Meaning | Corrective action |
| --- | --- | --- |
| `dumpcap was not found` | Wireshark CLI is absent or not on `PATH` | Install TShark/dumpcap and reopen the shell |
| No interfaces listed | Capture driver or OS permissions are missing | Check Npcap, ChmodBPF, Linux group/capabilities, and service account |
| Interface test fails | Wrong interface, inactive link, or denied capture | Re-run `dumpcap -D` and verify link and privilege |
| Empty NDJSON | Capture worked but decoding failed or yielded no records | Run `tshark -r <file> -T ek` manually |
| HTTP `000` | No valid HTTP response | Check DNS, TLS, proxy, firewall, and timeout |
| HTTP `400` | Endpoint rejected the payload contract | Preserve evidence and compare API schema |
| HTTP `401` | Endpoint reached, session authentication rejected | Generate a new live-capture token for the active session |
| HTTP `403` | Identity recognized but action not authorized | Verify tenant, role, session ownership, and collector approval |
| HTTP `404` | Wrong or unpublished route | Verify the exact deployed endpoint |
| HTTP `413` | Batch exceeds request limit | Reduce slice duration or implement supported chunking |
| HTTP `429` | Rate or capacity limit reached | Honor server backoff and reduce request frequency |
| HTTP `5xx` | Backend failure | Preserve evidence and inspect backend logs |

## HTTP 401 after a successful capture

HTTP `401` proves the local agent captured traffic, decoded it, resolved the hostname, established HTTPS, and reached the ingest route. Check:

1. The token came from **Live Capture**, not website login or browser developer tools.
2. The token belongs to the selected active session.
3. Token creation and ingestion use the same published environment.
4. Only the token value was pasted, without `Bearer`, quotes, or surrounding whitespace.
5. The token has not expired, been revoked, or been exposed previously.

If a newly generated token still returns `401`, investigate environment mismatch, token hashing, inactive-session validation, tenant ownership, proxy header stripping, and UI/backend deployment drift.

## Windows

```powershell
Get-Command dumpcap
Get-Command tshark
& dumpcap -D
Test-NetConnection net-chat-insight.lovable.app -Port 443
Get-Service amdai-collector
```

Confirm Npcap and TShark were selected during Wireshark installation. Use an elevated PowerShell window for first validation.

## macOS

```bash
ls -l /Applications/Wireshark.app/Contents/MacOS/dumpcap
ls -l /Applications/Wireshark.app/Contents/MacOS/tshark
export PATH="/Applications/Wireshark.app/Contents/MacOS:$PATH"
dumpcap -D
launchctl list | grep -E 'com\.amdai\.(collector|app)'
```

If capture permission fails, install ChmodBPF and reopen Terminal. Do not paste the complete Bash script into interactive zsh.

## Linux

```bash
command -v dumpcap
command -v tshark
id
getcap "$(command -v dumpcap)" 2>/dev/null || true
dumpcap -D
systemctl status amdai-collector.service
journalctl -u amdai-collector.service -n 100 --no-pager
```

Sign out and back in after group changes. Avoid running the entire collector as root.

## Docker Compose

```bash
cd collector/deploy
set -a
. ./.env
set +a
docker compose --env-file .env --env-file "profiles/$AMDAI_PROFILE.env" config
docker compose ps
docker compose logs --tail 100 collector
docker compose logs --tail 100 postgres
```

Verify that `.env` contains no placeholder values and that `AMDAI_LOCAL_PG` uses the same database user, password, and database name as the Postgres service.

## Capture drops

A one-packet test can show an alarming drop percentage because the test stops immediately while buffered packets are flushed. Evaluate drop counters during representative sustained capture.

Persistent drops require one or more of:

- Dedicated capture NIC
- Reduced packet-broker output
- Justified capture filter
- Larger capture and kernel buffers
- Shallower protocol dissection
- More CPU, memory, and storage throughput
- Separate capture and analytics workloads

Do not claim line-rate performance until it is tested with representative packet sizes and protocol mixes.

## Retained evidence

Failed standalone uploads retain `.pcapng`, `.ndjson`, and the last HTTP response in the printed spool directory. Treat all retained files as sensitive evidence and apply approved retention and deletion procedures.
