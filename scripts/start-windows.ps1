$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envPath = Join-Path $projectDir '.env'
$envExamplePath = Join-Path $projectDir '.env.example'
$composeFile = Join-Path $projectDir 'compose.yaml'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker Desktop is required and docker was not found in PATH.'
}

docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker Compose v2 is required.'
}

docker info | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker Desktop is installed but its engine is not running.'
}

if (-not (Test-Path $envPath)) {
    Copy-Item $envExamplePath $envPath
}

$content = [System.IO.File]::ReadAllText($envPath)
if ($content -match '(?m)^WEBUI_SECRET_KEY=GENERATE_ON_FIRST_START$') {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $secret = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
    $content = $content -replace '(?m)^WEBUI_SECRET_KEY=GENERATE_ON_FIRST_START$', "WEBUI_SECRET_KEY=$secret"
}

$defaults = [ordered]@{
    WEBUI_ADMIN_NAME = 'NetTAP Administrator'
    WEBUI_ADMIN_EMAIL = 'admin@nettap.local'
    WEBUI_ADMIN_PASSWORD = 'admin'
}

foreach ($entry in $defaults.GetEnumerator()) {
    if ($content -notmatch "(?m)^$([regex]::Escape($entry.Key))=") {
        $content = $content.TrimEnd() + "`r`n$($entry.Key)=$($entry.Value)`r`n"
    }
}

[System.IO.File]::WriteAllText(
    $envPath,
    $content,
    [System.Text.UTF8Encoding]::new($false)
)

$compose = @(
    'compose',
    '--project-directory', $projectDir,
    '--env-file', $envPath,
    '-f', $composeFile
)

docker @compose config --quiet
docker @compose pull
docker @compose up -d ollama

$ready = $false
foreach ($attempt in 1..90) {
    docker @compose exec -T ollama ollama list 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $ready = $true
        break
    }
    Start-Sleep -Seconds 2
}

if (-not $ready) {
    throw 'Ollama did not become ready within three minutes.'
}

docker @compose --profile initialize run --rm model-init
if ($LASTEXITCODE -ne 0) {
    throw 'NetTAP model initialization failed.'
}

docker @compose up -d open-webui
docker @compose ps

$webPort = '3001'
foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
    if ($line -match '^WEB_PORT=(.+)$') {
        $webPort = $Matches[1]
    }
}

Write-Host "Open WebUI: http://127.0.0.1:$webPort"
Write-Host 'Fresh-install login: admin@nettap.local / admin'
Write-Host 'Immediately change the temporary password in Settings > Account.'
Write-Host 'Existing Open WebUI volumes keep their existing accounts and passwords.'
