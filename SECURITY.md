# Security policy

Please report suspected vulnerabilities privately through GitHub's **Security > Advisories > New draft security advisory** workflow. Do not include secrets, production packet captures, customer identifiers, or exploit details in public issues.

The repository contains no application account password. Fresh installations
use the fixed, non-personal login `admin@nettap.local` and generate a unique
bootstrap password on the deployment host. Shared or predictable defaults are
not permitted. The local credential file, activation record, environment file,
TLS keys, and evidence token are ignored by Git.

The canonical Compose identity is `nettap-network-intelligence`. Startup stops
legacy NetTAP containers without deleting their volumes and never silently
attaches an older account database to a fresh product installation. Existing
customer data enters the product only through an explicit, reviewed migration.

Version `0.3.0-rc.5` has production-hardening and profile-isolation controls but has not completed production or commercial certification. See [the security boundary](docs/SECURITY.md), [threat model](docs/THREAT_MODEL.md), and [release gates](docs/COMMERCIAL_RELEASE_GATES.md).
