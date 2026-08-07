# Migration to the unified RC7 application

RC7 replaces separate launchers/profiles and the public Evidence Workspace with one assistant and one authenticated Open WebUI.

1. Record the current Git commit, Compose project, containers, volumes and installed models.
2. Create and verify a complete backup.
3. Stop the older Compose project without deleting volumes.
4. Check out the approved RC7 commit/package.
5. Run the platform start command. The installer builds `nettap-ai:0.3.0-rc.7`, provisions one assistant and retires recognized older NetTAP tags only after validation.
6. Existing Open WebUI volumes keep their accounts. Supply a current administrator credential for provisioning if prompted.
7. Verify only port 3100 is public locally; Ollama and evidence processing remain internal.
8. Test combined network/packet behavior, attachments, restart, backup/restore and rollback before cutover.

Legacy volumes are not automatically attached to a fresh canonical install. Restore or migrate them only through an approved, backed-up procedure. Do not rename volumes or delete account databases as a login workaround.
