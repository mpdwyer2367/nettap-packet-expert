# NetTAP Network Intelligence

NetTAP Network Intelligence is an evidence-driven network visibility application for packet captures, NetFlow/IPFIX/sFlow telemetry, operational metrics, investigation workflows, capacity analysis, and conversational access to network evidence.

The repository contains:

- The Lovable web application and Supabase integration
- A TypeScript collector for packets, flows, probes, and device evidence
- Docker Compose and native collector installers
- Capacity profiles and preflight validation
- Reference live-capture agents for Windows, macOS, and Linux
- An experimental VM image builder

**Live development application:** https://net-chat-insight.lovable.app

> [!IMPORTANT]
> The hosted application and deployment tooling are under active development. Use authorized lab traffic until tenancy, retention, data minimization, installer signing, upgrade, and production support controls are validated.

## Documentation

- [Deployment manual](docs/DEPLOYMENT.md)
- [Configuration reference](docs/CONFIGURATION.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Security and data handling](docs/SECURITY.md)
- [Collector operator manual](collector/README.md)

## Deployment choices

| Goal | Recommended path |
| --- | --- |
| Develop the web application | Node.js and `npm run dev` |
| Test packet ingestion from one workstation | Standalone live-capture agent |
| Run the collector stack on a lab host | Docker Compose |
| Install a persistent collector service | Native Linux, macOS, or Windows installer |
| Build a VM disk image | Experimental `collector/deploy/build-ova.sh` |

See the [deployment manual](docs/DEPLOYMENT.md) before selecting a path.

## Local web development

Install Node.js with [nvm](https://github.com/nvm-sh/nvm#installing-and-updating), then:

```bash
git clone https://github.com/mpdwyer2367/net-chat-insight.git
cd net-chat-insight
npm ci
npm run dev
```

The frontend requires the Supabase browser configuration used by this project. Do not place service-role keys, database passwords, collector tokens, or live-capture session tokens in frontend environment files.

## Lovable synchronization

This project is connected to [Lovable](https://lovable.dev/projects/7968b127-f8dc-4eb1-a625-1cd8e8b61cb8). Changes merged into the connected branch synchronize back to Lovable. Do not rewrite published Git history.

## Authorization

Capture only interfaces and networks you own or are explicitly authorized to monitor. Packet and flow evidence can contain sensitive addressing, hostnames, protocol fields, and application details.
