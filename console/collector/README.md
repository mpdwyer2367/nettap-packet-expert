# NetTAP Network Intelligence Collector Appliance: Operator Manual

## 1. Architecture

> Compatibility note: current environment variables, service names, database names, and filesystem paths retain the internal `AMDAI` prefix. Keep these identifiers unchanged until a versioned configuration migration is implemented.

The NetTAP collector appliance is split into three tiers, all of which can run on one
VM or be split across hosts for larger deployments:

- **DB tier** — PostgreSQL 16 + TimescaleDB. Stores raw packets (short
  retention), flow metadata, minute rollups and summaries as hypertables
  with compression policies.
- **Collector tier** — the `collector/` service. Runs `dumpcap`/`tshark` for
  local capture, NetFlow/IPFIX/sFlow UDP receivers (ports 2055/4739/6343),
  a write path that batches into Postgres, minute rollups, retention/
  compression jobs, and an uplink that reports health/metrics to the NetTAP
  console and accepts capacity-limit updates from it.
- **Web tier** — the console UI (`web.Dockerfile`), talking to the collector
  API and the database for local dashboards, independent of the hosted
  NetTAP console.
- **Optional local Ollama** — an on-box LLM for offline/air-gapped
  summarization and Q&A, sized per profile; disabled by default outside the
  Docker Compose path.

```
 capture NIC/SPAN → dumpcap/tshark ─┐
 NetFlow/IPFIX/sFlow (UDP) ─────────┼─→ Collector → spool (disk) → Postgres/TimescaleDB
                     console pairing┘        ↑                          ↑
                                        capacity limits             Web tier / local Ollama
                                        (from console)
```

## 2. Sizing profiles

Profiles are defined once, in `src/lib/capacity.ts`, and mirrored by every
installer/preflight script in this directory. Do not hand-tune limits
without updating that file — it is the single source of truth read by the
console.

| Profile | vCPU | RAM   | Disk    | Flows/s ceiling | Capture ceiling | Typical use |
|---------|-----:|------:|--------:|-----------------:|-----------------:|-------------|
| small   | 4    | 8 GB  | 100 GB  | 5,000            | 200 Mbps         | Branch office / lab |
| medium  | 8    | 32 GB | 1,000 GB| 50,000           | 1 Gbps           | Single data-center vantage |
| large   | 16   | 64 GB | 2,000 GB| 120,000          | 5 Gbps           | Aggregated NPB feed, multi-site |
| xl      | 32   | 128 GB| 4,000 GB| 200,000 (250k burst) | 10 Gbps      | Line-rate metadata extraction |

Each profile also fixes defaults for ring-buffer size, snap length,
dissection depth/workers, receiver workers, socket buffers, COPY batch
size, spool ceiling and retention — see `profiles/*.env` (container/Postgres
tuning) and `CAPACITY_PROFILES` in `capacity.ts` (collector-internal
limits). Installers auto-detect host resources and pick the richest profile
the hardware can sustain (with a 10% tolerance), or accept `--profile` to
force one.

## 3. Install paths

All paths install the same collector application; they differ in how the
OS-level dependencies (Postgres/TimescaleDB, tshark/dumpcap, service
supervision) are provisioned.

| Path | Script | Platform | Notes |
|------|--------|----------|-------|
| Docker Compose | `deploy/docker-compose.yml` + `deploy/Dockerfile` / `web.Dockerfile` | Any Docker host | Fastest path; capture container runs with `CAP_NET_ADMIN`/`CAP_NET_RAW`, not `--privileged`. Configure via `.env` (`AMDAI_CONSOLE_URL`, `AMDAI_COLLECTOR_TOKEN`, `WEB_PORT`, and a `profiles/<size>.env`). |
| Linux (systemd) | `deploy/install-linux.sh` | Debian/Ubuntu (apt) or RHEL-family (dnf) | Installs Postgres 16 + TimescaleDB from PGDG/timescale repos, grants `dumpcap` capture capability via `setcap` (no root service), installs `amdai-collector.service` / `amdai-app.service`. |
| Windows | `deploy/install-windows.ps1` | Windows Server / 11 | Opens inbound UDP 2055/4739/6343 firewall rules, installs services via NSSM, applies the same capacity profile. |
| macOS (launchd) | `deploy/install-macos.sh` | macOS (Homebrew) | Installs `postgresql@16`, `timescaledb`, `wireshark` via Homebrew; sets up the Wireshark ChmodBPF LaunchDaemon + `access_bpf` group for non-root capture; installs user LaunchAgents. Recommended for small/medium only. |
| OVA / VM image | `deploy/build-ova.sh` | Any hypervisor that imports OVA/VMDK/qcow2 | Builds a Debian 12 image (Packer/qemu, or virt-install fallback) sized to a profile, with cloud-init first-boot pairing (`/opt/amdai-pairing/pair.sh`). |

Every install path finishes by writing `AMDAI_CONSOLE_URL` /
`AMDAI_COLLECTOR_TOKEN` and starting the collector; run
`collector/scripts/preflight.sh` before or after install to validate the
host.

## 4. Pairing with the console

1. In the NetTAP console, go to **Collectors → Add Collector** to generate a
   one-time pairing token.
2. Supply `--console-url` and `--token` to the installer (or set
   `AMDAI_CONSOLE_URL`/`AMDAI_COLLECTOR_TOKEN` in `.env` / `collector.env`
   / the Windows service environment).
3. The collector calls home on startup; it appears as **pending** in the
   console's Collectors list within about a minute.
4. Click **Approve** in the console. The console then pushes the capacity
   profile/limits it holds for this collector, which take precedence over
   local `profiles/*.env` defaults from that point on.
5. Tokens are single-use for initial pairing; re-pairing (e.g. after a
   database wipe) requires a new token from the console.

## 5. Capacity tuning — what each limit does

All limits live under `CapacityLimits` in `src/lib/capacity.ts` and are
editable per-collector from the console (validated against detected host
resources via `validateLimits`):

- **Import/file ingestion** — `max_import_bytes`, `max_packets_per_import`,
  `upload_chunk_bytes`, `import_concurrency`: bound offline pcap analysis so
  one large upload can't exhaust disk/CPU.
- **Live capture** — `ring_file_mb`/`ring_files` (dumpcap ring buffer size
  and depth — how much raw traffic survives on disk before rotation),
  `snaplen_bytes` (bytes captured per packet), `dissect_workers`/
  `dissect_depth` (how deep tshark parses application protocols vs. just
  headers).
- **Flow receivers** — `max_flows_per_second`/`max_packets_per_second`
  (sustained ingestion ceilings before shedding kicks in),
  `receiver_workers` (SO_REUSEPORT UDP listeners per flow port),
  `socket_buffer_mb` (kernel receive buffer per socket — pair with the
  sysctl `rmem` tuning below).
- **Write path** — `copy_batch_rows`/`flush_interval_ms` (Postgres COPY
  batching), `queue_high_water` (in-memory queue depth before spilling to
  the disk spool), `spool_max_gb` (spool ceiling before oldest segments are
  dropped), `rollup_seconds` (minute-rollup cadence).
- **Retention** — see §6.

Raising these numbers costs RAM/CPU/disk headroom; the console warns (or
blocks, for hard errors like exceeding detected vCPU/RAM/disk) before
saving an unsafe combination.

## 6. Backpressure / shed-stage behavior

When sustained flow/packet rates exceed the profile's ceiling, the
collector gives up fidelity in a fixed order (`SHED_ORDER` in
`capacity.ts`) rather than falling over or silently dropping data
unpredictably:

1. **`full`** — every packet dissected and stored, every flow recorded.
2. **`no_dissect`** — application-layer dissection is skipped; 5-tuple,
   byte/packet counts and timing stay exact. Frees CPU first, since
   dissection is usually the bottleneck before I/O is.
3. **`rollups_only`** — per-packet rows are discarded; minute rollups,
   flows and interface counters remain complete. Protects the database
   from being overwhelmed by row volume while keeping trend data intact.
4. **`sampled`** — flow records themselves are sampled; counts become
   statistical estimates until pressure clears. Last resort, used only
   when even rollup writes can't keep up.

The collector reports its current shed stage to the console so operators
can see when a box is under pressure and either raise the profile/limits
or reduce the offered load (fewer SPAN sources, coarser flow export
sampling upstream, etc.). Recovery is automatic: once queue depth and
receive rates fall back under the high-water marks, the stage steps back
down toward `full`.

## 7. Retention tiers

Three tiers, all governed by profile defaults but editable per-collector:

- **Raw packets** (`raw_packet_hours`) — full-fidelity packet rows for
  close-in drill-down; shortest retention (6h small → 72h xl).
- **Flow metadata** (`flow_metadata_days`) — 5-tuple/byte/packet flow
  records; medium retention (7 days small/medium → 30 days xl).
- **Summaries/rollups** (`summary_days`) — minute/hour rollups; longest
  retention (90 days small → 365 days large/xl).

`compress_after_hours` controls when TimescaleDB chunk compression kicks
in (should be well inside `raw_packet_hours`, or you're compressing data
that's about to be purged — the console flags this as a warning).
`local_max_gb` is a hard ceiling on total DB size; retention tightens
automatically as usage approaches it.

### Jobs and history schema

`sql/schema.sql` is applied on every start (idempotent) on top of the base
telemetry tables and adds:

- `amdai_rollup_flows(raw_hours)` — collapses closed raw flow minutes into
  `flow_rollups` (packets/bytes/flow counts + merged risk tags), then drains
  the rolled raw rows. Idempotent, so re-runs are free.
- `amdai_retention_cleanup(raw_hours, metadata_days, summary_days)` — rolls
  first, then enforces all three tiers, dropping whole daily partitions where
  possible and sweeping the rest with DELETE. Every run is logged to
  `retention_runs` with durations, row counts and the cutoffs used.
- `amdai_ensure_partitions(days_ahead)` / `amdai_drop_partitions_before()` —
  daily partition maintenance for the non-Timescale path.
- History views for the LLM: `history_flow_timeline` (raw + metadata tiers in
  one series, each row labelled with its `tier`), `history_top_talkers`,
  `history_service_mix` and `history_coverage` (what history actually exists
  per source, so the model never claims purged data).

The supervisor runs partition maintenance every 6h and the rollup +
cleanup pair hourly, plus once at startup. The local API exposes the same
history read-only: `GET /history/coverage|timeline|talkers|services|retention`
and `POST /history/retention/run`.

Validate a database against the schema and jobs with:

```
AMDAI_LOCAL_PG=postgres://... npm run validate:schema
```

It seeds raw and aged rows, runs both jobs, and asserts rollup accuracy,
idempotency, per-tier trimming, run logging and every history view.



## 8. Troubleshooting

Run `collector/scripts/preflight.sh --profile <p> --pg-url <url> --console-url <url>`
first — it covers most of the below in one pass and exits non-zero on hard
failures.

- **Collector shows "pending" forever in the console** — check
  `AMDAI_CONSOLE_URL`/`AMDAI_COLLECTOR_TOKEN` are set and the host can
  reach the console (`curl -v <console-url>/healthz`); check outbound
  firewall/proxy rules.
- **No packets captured** — verify `dumpcap` has capture capability:
  Linux: `getcap $(command -v dumpcap)` should show `cap_net_raw,cap_net_admin`;
  macOS: user must be in the `access_bpf` group and the ChmodBPF
  LaunchDaemon must be loaded; Windows: service account needs "Log on as a
  service" plus Npcap installed in WinPcap-compatible mode.
- **Flow records not arriving** — confirm UDP 2055/4739/6343 are open
  inbound (firewall, security group, NPB config) and not already bound by
  another process (`preflight.sh` checks this).
- **Collector reports `rollups_only`/`sampled` continuously** — the
  offered load exceeds the profile ceiling; either raise the profile/limits
  (if hardware allows — `validateLimits` will tell you) or reduce upstream
  volume.
- **Postgres connection refused / TimescaleDB missing** — confirm the
  service is running (`systemctl status postgresql` / `brew services list`
  / Windows Services) and `CREATE EXTENSION IF NOT EXISTS timescaledb;` has
  been run on the target database.
- **High packet loss under burst** — check `net.core.rmem_max` /
  `net.core.rmem_default` (Linux) against the profile's recommended values
  in `install-linux.sh apply_sysctl_tuning`; raise `socket_buffer_mb` and/or
  `receiver_workers`.

## 9. Upgrade

- **Docker Compose**: `docker compose pull && docker compose up -d`
  (persistent volumes hold DB/config/spool; no data loss on image
  upgrade).
- **Linux/macOS installers**: re-run `install-linux.sh` / `install-macos.sh`
  with the same flags — both are idempotent, re-stage the collector build,
  and restart services without touching the database or generated
  credentials.
- **Windows**: re-run `install-windows.ps1`; it updates the NSSM service
  definitions and restarts them.
- **OVA**: rebuild a new image with `build-ova.sh` and cut over the VM;
  point it at the same external Postgres if you want to preserve history,
  or export/import via `pg_dump`/`pg_restore` (see Backup below) if the DB
  lives on the same VM.
- Always take a backup (below) before upgrading across a major TimescaleDB
  or PostgreSQL version.

## 10. Backup

- **Database**: `pg_dump --format=custom` against the `amdai_collector`
  database (or `pg_basebackup` for full physical backups including
  TimescaleDB compressed chunks). Restore with `pg_restore` into a fresh
  database with the `timescaledb` extension already created.
- **Configuration**: back up `collector.env` (Linux/macOS) or the NSSM
  environment block (Windows) — these hold the pairing token and DB
  credentials; treat them as secrets.
- **Spool**: the on-disk spool (`collector/data/spool`) is transient
  write-behind buffering, not a backup target — it should drain to
  Postgres under normal operation.
- Schedule backups outside business-peak capture windows; a `pg_dump` of a
  multi-hundred-GB hypertable can itself add meaningful I/O load on
  `large`/`xl` profiles.
