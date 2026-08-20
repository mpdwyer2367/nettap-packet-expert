# Administrator activation and account access

## Fresh installation

An empty Open WebUI data volume creates one local administrator:

- Display name: `NetTAP Administrator`
- Login: `admin@nettap.local`
- Password: a unique value generated on the deployment host
- Role: `admin`

There is no shared default password. The ignored file `.bootstrap-admin-password` is created with restricted local permissions and contains the one-time value. Open WebUI creates the account only when its user database is empty; existing volumes keep their existing accounts.

## Required activation

1. Keep the application on `127.0.0.1`.
2. Sign in using the generated credential file.
3. In **Settings > Account**, choose a unique password of 12–72 characters with upper, lower, number, and symbol.
4. Sign out, verify the generated password fails, and verify the new password succeeds.
5. Run `./scripts/finalize-admin.sh --confirm` and type `FINALIZE`.

Finalization removes the local credential file, marks the bootstrap value retired in `.env`, and creates an ignored activation record. Production startup refuses to enable the TLS gateway until this record exists.

## Enforcement boundary

The repository enforces production blocking and credential-file retirement. The operator confirmation remains a human assertion that the old password was rejected; stock Open WebUI does not expose a dedicated forced-first-login transaction to this Compose deployment. The activation warning is present in the loopback profile and removed by the production overlay after the activation gate.

## Existing installations

Generated bootstrap credentials never reset an existing database. To list user identity and role without displaying password hashes:

```bash
docker compose --env-file .env -f compose.yaml -f compose.local.yaml exec -T open-webui python - <<'PY'
import sqlite3
db = sqlite3.connect('/app/backend/data/webui.db')
for row in db.execute('SELECT name, email, role, created_at FROM user ORDER BY created_at'):
    print(' | '.join(str(value) for value in row))
PY
```

If access is lost, create a verified backup and follow the official Open WebUI password-reset procedure. Never delete `webui.db` as an access workaround; that can remove accounts, chats, settings, and knowledge.

### Explicit local default recovery

For an intentionally simple loopback-only development credential, run:

```bash
./scripts/reset-local-admin.sh --confirm-insecure-default
```

This resets an existing administrator in place, writes a timestamped database backup beside `webui.db`, and configures these local credentials:

- Display name: `admin`
- Login email: `admin@nettap.local`
- Password: `password`

Open WebUI uses an email address for password sign-in, so enter `admin@nettap.local`, not the bare name `admin`. The command refuses production mode and any bind address other than `127.0.0.1`. Signup remains disabled. Replace the default password before exposing the application beyond the deployment host.

To reset or reidentify the retained local administrator with a specific email,
run the supported command and enter the new password twice at the hidden prompt:

```bash
./scripts/nettap-ai reset-password \
  --email matt.dwyer@nettaptech.com \
  --name "Matthew Dwyer" \
  --role admin \
  --create-if-missing \
  --confirm
```

If the email does not exist, `--create-if-missing` safely reidentifies the
retained administrator record instead of creating a second disconnected local
administrator. The command backs up `webui.db`, preserves the account ID and
associated data, keeps signup disabled, and is refused outside loopback local mode.

## Production account policy

- Signup is disabled.
- Additional accounts require an approved administrator workflow.
- One application instance serves one customer or trust boundary.
- Use an 8-hour session lifetime in this candidate.
- API keys, web search, direct tool servers, sub-agents, user webhooks, non-admin file/web uploads, sharing/import/export, code execution, memories, admin exports, and admin chat access are disabled by default.
- SSO/MFA is not part of the certified candidate scope; customers requiring it need a separately engineered and validated identity profile.

## Acceptance

Record generated-login success, password replacement, old-password rejection, new-password persistence after restart, disabled signup, administrator role, session expiry, and production-gateway refusal before finalization. Never record either password in the acceptance report.

Official references:

- [Open WebUI environment configuration](https://docs.openwebui.com/reference/env-configuration/)
- [Open WebUI hardening](https://docs.openwebui.com/getting-started/advanced-topics/hardening/)
- [Open WebUI password reset](https://docs.openwebui.com/troubleshooting/password-reset/)
