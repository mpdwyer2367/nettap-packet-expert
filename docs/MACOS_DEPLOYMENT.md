# macOS deployment

## Evaluation profile

Requirements: supported macOS on Apple silicon or Intel, Docker Desktop with Compose v2, 16 GiB system memory recommended, and 15 GiB free disk.

```bash
git clone https://github.com/mpdwyer2367/nettap-packet-expert.git
cd nettap-packet-expert
chmod +x scripts/* tests/*.sh
./scripts/start-macos.sh
```

Open <http://127.0.0.1:3001>. Sign in as `admin@nettap.local` with the password in the protected path printed by the script. Change it, prove the generated value fails, then run `./scripts/finalize-admin.sh --confirm`.

Validate:

```bash
./tests/static-checks.sh
./scripts/verify-macos-deployment.sh
./tests/macos-e2e.sh
./tests/model-behavior-eval.sh
```

The automated and manual reports must be tied to the exact commit. Apple silicon inference in this Linux-container profile is CPU-compatible; it does not use Metal.

## Production candidate

Production requires 8 Docker CPUs, 16 GiB Docker memory, 40 GiB free disk, customer TLS, immutable image digests, a passing vulnerability scan, backup/restore evidence, runtime verification, and signed acceptance. Follow [the customer deployment guide](CUSTOMER_DEPLOYMENT_GUIDE.md). A macOS runtime pass applies only to the tested macOS, architecture, Docker versions, allocation, images, and commit.
