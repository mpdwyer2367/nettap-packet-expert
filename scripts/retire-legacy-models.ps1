[CmdletBinding()]
param(
    [switch]$Confirm,
    [switch]$IncludeNative
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envPath = Join-Path $projectDir '.env'
$composeFile = Join-Path $projectDir 'compose.yaml'
$localComposeFile = Join-Path $projectDir 'compose.local.yaml'
$productionComposeFile = Join-Path $projectDir 'compose.production.yaml'

function Get-EnvValue([string]$Name) {
    $line = Get-Content $envPath | Where-Object { $_ -like "$Name=*" } | Select-Object -Last 1
    if (-not $line) { throw "Missing $Name in .env." }
    return $line.Substring($Name.Length + 1)
}

function Test-NetTAPTag([string]$Name) {
    return (
        $Name -like 'nettap-ai:*' -or
        $Name -like 'nettap-ai-backup-*' -or
        $Name -like 'nettap-packet-expert:*' -or
        $Name -like 'nettap-network-visibility:*'
    )
}

function ConvertFrom-OllamaList([string[]]$Rows) {
    $names = @()
    foreach ($row in $Rows | Select-Object -Skip 1) {
        $trimmed = $row.Trim()
        if ($trimmed) { $names += ($trimmed -split '\s+')[0] }
    }
    return $names
}

if (-not (Test-Path $envPath)) {
    throw 'NetTAP Network Intelligence is not initialized; .env is missing.'
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker Desktop is required.'
}
docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose v2 is required.' }

$mode = Get-EnvValue 'DEPLOYMENT_MODE'
$compose = @(
    'compose', '--project-directory', $projectDir, '--env-file', $envPath,
    '-f', $composeFile
)
if ($mode -eq 'production') {
    $compose += @('-f', $productionComposeFile)
} else {
    $compose += @('-f', $localComposeFile)
}

$containerId = (docker @compose ps -q ollama).Trim()
if (-not $containerId) { throw 'The canonical containerized Ollama service is not running.' }

$currentModel = Get-EnvValue 'NETTAP_AI_MODEL'
$baseModel = Get-EnvValue 'BASE_MODEL'
$containerRows = @(docker @compose exec -T ollama ollama list)
if ($LASTEXITCODE -ne 0) { throw 'Unable to list appliance Ollama models.' }
$containerModels = @(ConvertFrom-OllamaList $containerRows)
if ($currentModel -notin $containerModels) {
    throw "Current NetTAP Network Intelligence Model is not installed: $currentModel"
}
$containerCandidates = @(
    $containerModels | Where-Object { $_ -ne $currentModel -and (Test-NetTAPTag $_) }
)

$nativeCandidates = @()
if ($IncludeNative) {
    if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
        throw 'Native Ollama was requested but its command is unavailable.'
    }
    $savedOllamaHost = $env:OLLAMA_HOST
    Remove-Item Env:OLLAMA_HOST -ErrorAction SilentlyContinue
    try {
        $nativeRows = @(ollama list)
        if ($LASTEXITCODE -ne 0) { throw 'Native Ollama is unavailable; no native tags were changed.' }
        $nativeCandidates = @(
            ConvertFrom-OllamaList $nativeRows | Where-Object { Test-NetTAPTag $_ }
        )
    } finally {
        if ($null -ne $savedOllamaHost) { $env:OLLAMA_HOST = $savedOllamaHost }
    }
}

Write-Host 'NetTAP Network Intelligence model lifecycle'
Write-Host "Current container model: $currentModel"
Write-Host "Shared base model retained: $baseModel"
if ($containerCandidates.Count -eq 0) { Write-Host 'Legacy container tags: none' }
foreach ($model in $containerCandidates) { Write-Host "Legacy container tag: $model" }
if ($IncludeNative) {
    if ($nativeCandidates.Count -eq 0) { Write-Host 'Legacy native tags: none' }
    foreach ($model in $nativeCandidates) { Write-Host "Legacy native tag: $model" }
}

if (-not $Confirm) {
    Write-Host 'Dry run only. Rerun with -Confirm after backup and acceptance.'
    exit 0
}

foreach ($model in $containerCandidates) {
    docker @compose exec -T ollama ollama rm $model
    if ($LASTEXITCODE -ne 0) { throw "Failed to retire appliance tag: $model" }
}

if ($IncludeNative) {
    $savedOllamaHost = $env:OLLAMA_HOST
    Remove-Item Env:OLLAMA_HOST -ErrorAction SilentlyContinue
    try {
        foreach ($model in $nativeCandidates) {
            ollama rm $model
            if ($LASTEXITCODE -ne 0) { throw "Failed to retire native tag: $model" }
        }
    } finally {
        if ($null -ne $savedOllamaHost) { $env:OLLAMA_HOST = $savedOllamaHost }
    }
}

$remainingRows = @(docker @compose exec -T ollama ollama list)
$remainingModels = @(ConvertFrom-OllamaList $remainingRows)
if ($currentModel -notin $remainingModels) {
    throw 'Current model disappeared during retirement; stop and investigate.'
}
$remainingLegacy = @(
    $remainingModels | Where-Object { $_ -ne $currentModel -and (Test-NetTAPTag $_) }
)
if ($remainingLegacy.Count -gt 0) {
    throw "Legacy container tags remain: $($remainingLegacy -join ', ')"
}

Write-Host "PASS: $currentModel is the only NetTAP model tag in the appliance Ollama store."
Write-Host 'The two Open WebUI experiences remain lightweight profiles over this one model.'
Write-Host 'No Docker volume, Open WebUI account, chat, knowledge collection, or non-NetTAP model was removed.'
