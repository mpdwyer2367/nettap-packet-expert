Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$reportDir = Join-Path $projectDir 'reports'
New-Item -ItemType Directory -Force $reportDir | Out-Null
$reportFile = Join-Path $reportDir ("windows-e2e-{0}.txt" -f (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))
Start-Transcript -Path $reportFile -Force
try {
    if ($env:OS -ne 'Windows_NT') { throw 'Windows host required.' }
    & (Join-Path $projectDir 'tests\Static-Checks.ps1')
    & (Join-Path $projectDir 'scripts\Start-Windows.ps1')
    . (Join-Path $projectDir 'scripts\Windows-Common.ps1')
    $modelName = Get-EnvironmentValue 'MODEL_NAME'
    $webPort = Get-EnvironmentValue 'WEB_PORT'
    $modelInfo = & docker compose --project-directory $ProjectDir --env-file $EnvFile -f $ComposeFile exec -T ollama ollama show $modelName
    if (($modelInfo -join "`n") -notmatch 'NetTAP Packet Expert') { throw 'Custom model identity was not found.' }
    $response = & docker compose --project-directory $ProjectDir --env-file $EnvFile -f $ComposeFile exec -T ollama ollama run $modelName 'Ask one important question and do not claim that you have live packet data.'
    if (-not ($response -join '').Trim()) { throw 'Model returned an empty response.' }
    $healthy = $false
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        try { Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$webPort/health" -TimeoutSec 5 | Out-Null; $healthy = $true; break } catch { Start-Sleep -Seconds 2 }
    }
    if (-not $healthy) { throw 'Open WebUI health endpoint was not ready.' }
    $published = (& docker compose --project-directory $ProjectDir --env-file $EnvFile -f $ComposeFile port open-webui 8080).Trim()
    if ($published -notmatch '^127\.0\.0\.1:') { throw "Open WebUI is not loopback-only: $published" }
    Invoke-Compose restart ollama open-webui
    Invoke-Compose exec -T ollama ollama show $modelName
    $healthy = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try { Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$webPort/health" -TimeoutSec 5 | Out-Null; $healthy = $true; break } catch { Start-Sleep -Seconds 2 }
    }
    if (-not $healthy) { throw 'Open WebUI did not recover after restart.' }
    Write-Host 'PASS: model identity, inference, UI health, loopback binding, and restart persistence checks completed.'
} finally { Stop-Transcript }
