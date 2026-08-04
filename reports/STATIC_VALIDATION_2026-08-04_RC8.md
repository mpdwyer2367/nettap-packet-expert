# NetTAP Packet Expert RC8 static validation

Date: 2026-08-04  
Scope: `0.1.0-rc.8` source package and administrator-bootstrap change

## Result

**PASS — source and documentation validation**

The repository static-check harness completed successfully after the RC8 changes. Additional documentation-link, Markdown-fence, YAML-structure, and PowerShell structural checks also passed.

## Validated controls

- Base model remains explicitly pinned to `qwen2.5:7b-instruct-q4_K_M`.
- Custom model name is `nettap-packet-expert:0.1.0-rc.8`.
- Web access remains bound to `127.0.0.1` by default.
- Fresh-install administrator variables are present.
- Fresh-install identifier is `admin@nettap.local`.
- Temporary bootstrap password is `admin` as explicitly required for this evaluation package.
- Public signup is disabled.
- Password-change UI and strong replacement-password validation are enabled.
- A bootstrap-password warning banner is configured.
- Existing-volume preservation is documented.
- macOS and Windows deployment instructions are present.
- Shell syntax and required-file checks pass.
- Relative documentation links resolve.
- No private key or GitHub token pattern was detected by the supplied checks.

## Upstream behavior reviewed

The pinned Open WebUI `v0.11.0` source was reviewed to confirm that:

- `WEBUI_ADMIN_EMAIL` and `WEBUI_ADMIN_PASSWORD` create an administrator only when no user exists;
- automatic administrator creation disables signup;
- the sign-in form requires an email-formatted identifier;
- password updates validate the replacement password;
- existing users prevent bootstrap-account recreation.

## Runtime status

- macOS container runtime: **NOT RUN in this validation environment**
- Windows Docker Desktop runtime: **NOT RUN**
- Apple silicon and Intel hardware acceptance: **NOT RUN**
- Fresh-volume login and password-change browser acceptance: **MANUAL TEST REQUIRED**
- Password-change persistence after restart: **MANUAL TEST REQUIRED**

This report does not authorize describing RC8 as fully runtime-validated. Execute `tests/macos-e2e.sh` on each advertised macOS architecture and complete the manual authentication checklist in `docs/AUTHENTICATION.md`. Complete and record the Windows checklist before advertising Windows validation.
