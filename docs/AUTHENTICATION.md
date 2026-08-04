# Administrator bootstrap and account access

## Intended fresh-install workflow

NetTAP Packet Expert RC8 uses Open WebUI's supported headless administrator creation. On the first start of an empty Open WebUI data volume, the application creates:

- Display name: `NetTAP Administrator`
- Login: `admin@nettap.local`
- Temporary password: `admin`
- Role: `admin`

The login contains `@nettap.local` because the stock Open WebUI sign-in page requires an email-formatted value. This is a local identifier; it does not need to receive email.

Open WebUI creates this account only when no user exists. It does not overwrite, rename, demote, or reset an existing account. Existing installations therefore retain their current users, passwords, roles, chats, knowledge, and settings.

## Required first-session action

1. Keep the application bound to `127.0.0.1`.
2. Open `http://127.0.0.1:3001`.
3. Sign in with `admin@nettap.local` and `admin`.
4. Open **Settings > Account**.
5. Enter `admin` as the current password.
6. Choose a unique password with 12–72 characters, including uppercase, lowercase, number, and symbol.
7. Save the change.
8. Sign out and sign in with the new password.
9. Confirm that the old password no longer works.

Do not expose the application through bridged networking, a non-loopback bind address, port forwarding beyond the local host, or a reverse proxy before completing this change.

## Enforcement boundary

Open WebUI v0.11.0 supports automatic administrator creation and a password-change form. It does not provide a native forced-password-change-on-first-login state. This release therefore provides:

- host-loopback binding by default;
- disabled signup;
- a visible bootstrap-password warning banner;
- strong validation for the replacement password;
- documented manual acceptance checks.

The warning is not equivalent to a technically enforced first-login reset. Do not claim otherwise. A future appliance requiring hard enforcement must add and validate a dedicated first-boot identity gate.

## Existing installations

If a Docker volume already contains an Open WebUI user, the bootstrap credentials will not work. Use the existing administrator account. To inspect accounts without displaying password hashes:

```bash
docker compose --env-file .env -f compose.yaml exec -T open-webui python - <<'PY'
import sqlite3

db = sqlite3.connect('/app/backend/data/webui.db')
for row in db.execute(
    'SELECT name, email, role, created_at FROM user ORDER BY created_at'
):
    print(' | '.join(str(value) for value in row))
PY
```

If the administrator password is lost, follow the official Open WebUI password-reset process and create a verified backup before changing the database. Do not delete `webui.db` unless permanent removal of accounts, chats, settings, and knowledge is intended.

## Account policy

- Additional signup is disabled by default.
- Administrators can deliberately enable and govern additional accounts in Open WebUI after reviewing access requirements.
- Never publish `.env`; it contains the application secret and temporary bootstrap configuration.
- Do not reuse the temporary password after the first session.
- Authentication does not grant live packet, telemetry, appliance, or network-control access.

## Acceptance record

Record these results for each release platform:

| Check | Expected result |
|---|---|
| Empty-volume startup | Bootstrap administrator is created |
| Initial login | `admin@nettap.local / admin` succeeds on loopback |
| Role | Account is `admin` |
| Signup | New public registration is unavailable |
| Password change | Strong replacement password is accepted |
| Old password | `admin` fails after the change |
| New password | Sign-out/sign-in succeeds |
| Persistence | New password survives container restart |
| Existing volume | Existing credentials are unchanged |

## Authoritative references

- [Open WebUI environment configuration](https://docs.openwebui.com/reference/env-configuration/)
- [Open WebUI roles](https://docs.openwebui.com/features/authentication-access/rbac/roles/)
- [Open WebUI administrator password reset](https://docs.openwebui.com/troubleshooting/password-reset/)
