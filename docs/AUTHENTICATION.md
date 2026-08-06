# Administrator activation and account access

## Fresh installation

An empty Open WebUI data volume creates one local administrator:

- Display name: `NetTAP Administrator`
- Login: `admin@nettap.local`
- Password: a unique value generated on the deployment host
- Role: `admin`

There is no shared default password. The ignored file `.bootstrap-admin-password` is created with restricted local permissions and contains the one-time value. Open WebUI creates the account only when its user database is empty; existing volumes keep their existing accounts.

The canonical Compose project is `nettap-network-intelligence`. A fresh product
installation never attaches the older `nettap-packet-expert` account database.
Startup stops legacy containers but preserves their volumes for an explicit,
reviewed migration. This prevents an experimental or personal account from
silently becoming the administrator of a new customer installation.

Static shared credentials are prohibited in the production profile. They are
publicly guessable, conflict with the enforced password policy, and would place
every appliance behind the same credential.
The fixed, non-personal login is `admin@nettap.local`; its initial password is
unique per installation and must be replaced before production activation.

## User-facing sign-in path

The product welcome pages on local ports 3000 and 3001, and the production
`/visibility/` and `/packet-expert/` routes, explain the account boundary and
provide a **Sign in and open this experience** action. These pages do not accept,
proxy, log, or store credentials. Open WebUI remains the authoritative
authentication and session service.

An unauthenticated user is sent to the Open WebUI sign-in page and returned to
the selected managed Workspace Model. An authenticated user moves between both
experiences without a second login. The URL selects a starting profile; it is
not an authorization control. Open WebUI model, knowledge, Skill, tool, and user
access rules remain authoritative.

## Required activation

1. Keep the application on `127.0.0.1`.
2. Open the desired welcome page, select **Sign in and open this experience**,
   and sign in using the generated credential file.
3. In **Settings > Account**, choose a unique password of 12–72 characters with upper, lower, number, and symbol.
4. Sign out, verify the generated password fails, and verify the new password succeeds.
5. Run `./scripts/finalize-admin.sh --confirm` and type `FINALIZE`.

Finalization removes the local credential file, marks the bootstrap value retired in `.env`, and creates an ignored activation record. Production startup refuses to enable the TLS gateway until this record exists.

The activation record is bound to the effective Compose project. An activation
record from a legacy or different deployment cannot authorize production.

## Enforcement boundary

The repository enforces production blocking and credential-file retirement. The operator confirmation remains a human assertion that the old password was rejected; stock Open WebUI does not expose a dedicated forced-first-login transaction to this Compose deployment. The welcome page makes the required change explicit, and the activation warning is present in the loopback profile and removed by the production overlay after the activation gate.

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

When automatic provisioning detects that the bootstrap identity in `.env` does
not match an administrator account retained in the volume, it asks once for
the current Open WebUI administrator email and password in the interactive
terminal. Pressing Enter at the email prompt retains the displayed default.
The email override and password are used only for the one-shot provisioner;
the password travels over standard input and is not printed or logged. Neither
value is written back to `.env` or stored in the provisioning state. A rejected
retry stops installation without resetting accounts, chats, settings, or
knowledge.

If access is lost, create a verified backup and follow the official Open WebUI password-reset procedure. Never delete `webui.db` as an access workaround; that can remove accounts, chats, settings, and knowledge.

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
