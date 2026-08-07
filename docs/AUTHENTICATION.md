# Authentication and administrator activation

All user access goes through the single Open WebUI at port 3100 locally or the configured TLS gateway in production. Ollama and evidence processing have no user-facing login or host port.

## Fresh installation

The installer creates one administrator:

- Email: `admin@nettap.local`
- Password: a unique random bootstrap value written to `.bootstrap-admin-password`

No universal `admin/admin` credential is used. The credential file is local, mode 0600, ignored by Git and must never be included in a package or repository.

1. Sign in with the generated value.
2. Change the password in Settings > Account.
3. Sign out and verify the generated value is rejected.
4. Run `./scripts/finalize-admin.sh --confirm` and type `FINALIZE`.
5. Store the new credential in the organization’s approved password manager.

## Existing volumes

An existing Open WebUI data volume retains its existing users and password hashes. Environment variables do not overwrite them. If provisioning requests credentials, enter a current administrator email/password interactively; neither is committed.

`./scripts/nettap-ai recover-admin --confirm --email admin@nettap.local` creates a protected database backup, resets that exact administrator to the canonical `admin@nettap.local` identity with a new random one-time password and invalidates sessions. The password is written only to the local mode-0600 `.bootstrap-admin-password` file. If `--email` is omitted, recovery still requires exactly one administrator; with multiple administrators, the command refuses to guess which account to change.

## Production controls

Production startup requires completed password finalization, TLS configuration, immutable image digests and release security gates. Keep signup disabled. Use individual named accounts for operators, least-privilege roles and the Open WebUI audit log. Never share an administrator password among customers or embed credentials in images, Compose files, documentation or GitHub releases.
