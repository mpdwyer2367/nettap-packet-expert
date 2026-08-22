# NetTAP Deployment Configuration Reference

## 1. Credential types

| Credential | Used by | Storage rule |
| --- | --- | --- |
| Supabase publishable key | Browser application | May be present in frontend configuration, but does not replace server authorization |
| Supabase service-role key | Trusted backend only | Never expose to the browser or commit to Git |
| Collector pairing token | Full collector appliance | Single-use enrollment credential; store in protected service configuration |
| Live-capture session token | Standalone upload agent | Short-lived session bearer credential; prompt interactively |
| Database password | Collector and TimescaleDB | Store in an approved secret store or restricted service configuration |

## 2. Compose and collector environment

Copy `collector/deploy/.env.example` to `collector/deploy/.env`. The `.env` file is intentionally ignored by Git.

| Variable | Required | Description |
| --- | --- | --- |
| `AMDAI_PROFILE` | Yes | `small`, `medium`, `large`, or `xl` |
| `AMDAI_CONSOLE_URL` | Yes | Base URL of the console paired with the collector |
| `AMDAI_COLLECTOR_TOKEN` | Yes for initial pairing | Collector enrollment token, not a live-capture token |
| `AMDAI_API_PORT` | No | Local collector API port, default `8787` |
| `AMDAI_LOCAL_PG` | Yes | PostgreSQL connection string used by the collector |
| `POSTGRES_USER` | Compose | Local database user |
| `POSTGRES_PASSWORD` | Compose | Strong unique database password |
| `POSTGRES_DB` | Compose | Local database name |
| `WEB_PORT` | No | Host port for the local web tier, default `8443` |
| `OLLAMA_MODEL` | Optional | Model pulled when the Compose `ollama` profile is enabled |

The `AMDAI_*` namespace is a compatibility interface in the current code. Renaming it requires a versioned migration across installers, Compose, services, application code, and customer configurations.

## 3. Collector configuration file

The collector loads `config/collector.json`. If missing, it seeds the file from generated defaults. Key sections are:

| Section | Purpose |
| --- | --- |
| `captures` | Packet interfaces, BPF filters, slice duration, promiscuous mode, observation point, and packet-uplink behavior |
| `flow_receivers` | NetFlow, IPFIX, and sFlow ports, bind addresses, exporter allowlists, and sampling metadata |
| `icmp` | Availability probes |
| `snmp` | SNMPv2c or SNMPv3 polling targets and OIDs |
| `wmi` | Windows monitoring targets and WQL queries |
| `devices` | Approved SNMP or SSH collection from network devices |
| `broker` | NetTAP MATRIX or packet-broker API source |
| `retention` | Raw evidence hours, metadata days, and local storage ceiling |
| `uplink` | Evidence classes uploaded to the console and batching interval |
| `api` | Local API port and bind address |
| `capacity` | Resource, ingestion, spool, and retention limits |

Example capture input:

```json
{
  "captures": [
    {
      "interface_name": "ens192",
      "enabled": true,
      "filter": "",
      "slice_seconds": 5,
      "promiscuous": true,
      "vantage": "packet_broker_output",
      "observation_point": "NetTAP tool port 1",
      "push_packets": false
    }
  ]
}
```

Do not replace the complete file with this fragment. Merge the capture entry into the generated configuration.

## 4. Default network ports

| Port | Protocol | Direction | Function |
| ---: | --- | --- | --- |
| 443 | TCP | Outbound | Hosted console and live ingest |
| 8787 | TCP | Local by default | Collector API and health endpoint |
| 8443 | TCP | Inbound when enabled | Local web tier host port |
| 2055 | UDP | Inbound | NetFlow receiver |
| 4739 | UDP | Inbound | IPFIX receiver |
| 6343 | UDP | Inbound | sFlow receiver, disabled in default collector config |
| 5432 | TCP | Internal/local | PostgreSQL |
| 11434 | TCP | Internal/local | Ollama API when enabled |

Bind the collector API to `127.0.0.1` unless remote access is intentionally designed, authenticated, encrypted, and firewall-restricted.

## 5. Standalone agent configuration

The reference agents support:

| Setting | Default | Purpose |
| --- | --- | --- |
| `NETTAP_ENDPOINT` | Hosted `/api/public/live-ingest` endpoint | Upload destination |
| `NETTAP_SLICE_SECONDS` | `5` | Capture and upload batch duration |
| `NETTAP_CAPTURE_FILTER` | Empty | Optional libpcap capture filter |
| Interface | Interactive | Capture source |
| Token | Hidden interactive prompt | Live-capture session authentication |

Examples:

```bash
export NETTAP_SLICE_SECONDS=10
export NETTAP_CAPTURE_FILTER='net 192.0.2.0/24 and not port 22'
bash collector/deploy/live-capture/nettap-live-capture-linux.sh
```

Do not place `NETTAP_TOKEN` in shell history or a committed `.env` file.

## 6. Capture filters

`dumpcap -f` uses libpcap capture-filter syntax, not Wireshark display-filter syntax.

```text
host 192.0.2.10
net 192.0.2.0/24
tcp port 443
udp port 53
not port 22
```

Record the applied filter with every investigation. An incorrect filter can make present traffic appear absent.
