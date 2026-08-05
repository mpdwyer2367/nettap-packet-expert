[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows-Common.ps1')

if ($env:OS -ne 'Windows_NT') { throw 'This entry point is for Windows.' }
Assert-Runtime
Initialize-Environment
if ((Get-Item $ProjectDir).PSDrive.Free -lt 15GB) { throw 'At least 15 GiB of free disk is required.' }

Invoke-Compose config --quiet
Invoke-Compose pull
Invoke-Compose up -d ollama
$ready = $false
for ($attempt = 0; $attempt -lt 90; $attempt++) {
    & docker compose --project-directory $ProjectDir --env-file $EnvFile -f $ComposeFile exec -T ollama ollama list *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $ready) { throw 'Ollama did not become ready within three minutes.' }
Invoke-Compose --profile initialize run --rm model-init
Invoke-Compose up -d open-webui workspace-init
Invoke-Compose ps
$webPort = Get-EnvironmentValue 'WEB_PORT'
Write-Host "Open WebUI: http://127.0.0.1:$webPort"
Write-Host 'Keep loopback binding until TLS and access controls are configured.'
Write-Host 'After the first administrator is created, workspace-init privately imports knowledge, installs the formal Skill, attaches both to Packet Expert, and validates retrieval.'
