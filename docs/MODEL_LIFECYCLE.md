# Managing and publishing NetTAP Packet Expert

## What GitHub stores

GitHub is the authoritative source for the Ollama `Modelfile`, knowledge Markdown, formal Open WebUI Skills, manifests, Compose configuration, installers, tests, and documentation. These files reproduce the custom model behavior.

The repository does **not** store Qwen model blobs, Ollama Docker volumes, Open WebUI accounts, chats, passwords, or `.env`. The quantized base model is approximately 4.7 GB and must be pulled from the declared Ollama source. Large model backups do not belong in normal Git history.

## Update workflow

1. Create or switch to a feature branch.
2. Edit `model/Modelfile` for always-on model behavior.
3. Edit or add Markdown under `knowledge/`, then update `knowledge/manifest.json`.
4. Edit or add formal Skills under `workspace/skills/`, then update its `manifest.json`.
5. Add retrieval cases with distinctive expected markers for new knowledge domains.
6. Rebuild and validate on macOS:

```bash
./scripts/update-release.sh --confirm
```

On Windows PowerShell:

```powershell
.\scripts\Update-Release-Windows.ps1 -Confirm
```

The command runs static checks, rebuilds the Ollama model from the versioned `Modelfile`, synchronizes changed knowledge by SHA-256, updates formal Skills and model attachments, and runs real vector-retrieval validation.

7. Review the exact change set:

```bash
git status -sb
git diff --check
git diff
```

8. Commit and push only reviewed source files:

```bash
git add model knowledge workspace compose.yaml scripts tests docs README.md .env.example .gitignore
git commit -m "Update Packet Expert knowledge and model"
git push -u origin "$(git branch --show-current)"
```

Use a pull request for review before merging to the protected default branch. Record the operating-system version, architecture, Docker versions, model name, test report, and manual UI acceptance result in release notes.

## Updating installed systems

Pull the approved tag or commit, preserve `.env` and named Docker volumes, review changes, and run the platform update command. The provisioner is idempotent: unchanged files are not duplicated, changed managed files are replaced and reindexed, Skills are updated by stable ID, and model attachments are reconciled to the manifests.

Resources are created private to the first administrator. Sharing with approved users is a deliberate Open WebUI administration step and is not widened automatically by updates.

## Saving the installed Ollama data

The Git source is the preferred recovery method. For an offline or disaster-recovery snapshot of the downloaded base model and custom Ollama manifests, create a local volume backup:

```bash
./scripts/backup-ollama-volume.sh artifacts/nettap-ollama-backup.tar.gz
```

This can be several gigabytes. Store the archive and generated SHA-256 file in approved artifact storage or a controlled release system—not Git. Protect it according to organizational policy. Test restoration on a separate Docker volume before relying on it.

## Release acceptance

- Static and Compose checks pass.
- Ollama reports the expected custom model and system behavior.
- Every knowledge file in the manifest is indexed.
- Every retrieval case returns at least one expected marker.
- Every formal Skill is present and attached by stable ID.
- The workspace model is attached to the expected knowledge collection.
- Open WebUI health and restart persistence pass.
- Manual admin, login, prompt, model-selection, and sharing checks are recorded.
