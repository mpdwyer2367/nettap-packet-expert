$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envPath = Join-Path $projectDir '.env'
$envExamplePath = Join-Path $projectDir '.env.example'
$composeFile = Join-Path $projectDir 'compose.yaml'
$localComposeFile = Join-Path $projectDir 'compose.local.yaml'
$bootstrapComposeFile = Join-Path $projectDir 'compose.bootstrap.yaml'
$bootstrapPasswordPath = Join-Path $projectDir '.bootstrap-admin-password'

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
    RELEASE_VERSION = '0.3.0-rc.1'
    OLLAMA_IMAGE = 'ollama/ollama:0.32.5'
    OPEN_WEBUI_IMAGE = 'ghcr.io/open-webui/open-webui:v0.11.0'
    CADDY_IMAGE = 'caddy:2.11.4-alpine'
    BACKUP_IMAGE = 'alpine:3.24.1'
    BASE_MODEL = 'qwen2.5:7b-instruct-q4_K_M'
    NETWORK_VISIBILITY_MODEL = 'nettap-network-visibility:0.3.0-rc.1'
    PACKET_EXPERT_MODEL = 'nettap-packet-expert:0.3.0-rc.1'
    MODEL_NAME = 'nettap-packet-expert:0.3.0-rc.1'
    EXPECTED_BASE_MODEL_ID = '845dbda0ea48'
    BIND_ADDRESS = '127.0.0.1'
    WEB_PORT = '3100'
    VISIBILITY_LAUNCHER_PORT = '3000'
    PACKET_EXPERT_LAUNCHER_PORT = '3001'
    HTTPS_BIND_ADDRESS = '0.0.0.0'
    HTTPS_PORT = '8443'
    APPLIANCE_HOSTNAME = 'nettap-ai.local'
    JWT_EXPIRES_IN = '8h'
    OLLAMA_CPUS = '6'
    OLLAMA_MEMORY = '8g'
    WEBUI_CPUS = '2'
    WEBUI_MEMORY = '3g'
    GATEWAY_CPUS = '1'
    GATEWAY_MEMORY = '512m'
    WEBUI_ADMIN_NAME = 'NetTAP Administrator'
    WEBUI_ADMIN_EMAIL = 'admin@nettap.local'
    WEBUI_ADMIN_PASSWORD = 'GENERATE_ON_FIRST_START'
    DEPLOYMENT_MODE = 'local'
}

$content = $content -replace '(?m)^RELEASE_VERSION=0\.2\.0-rc\.1$', 'RELEASE_VERSION=0.3.0-rc.1'
$content = $content -replace '(?m)^MODEL_NAME=nettap-packet-expert:(0\.1\.0-rc\.8|0\.2\.0-rc\.1)$', 'MODEL_NAME=nettap-packet-expert:0.3.0-rc.1'
$content = $content -replace '(?m)^APPLIANCE_HOSTNAME=packet-expert\.local$', 'APPLIANCE_HOSTNAME=nettap-ai.local'
$content = $content -replace '(?m)^WEB_PORT=3001$', 'WEB_PORT=3100'
$content = $content -replace '(?m)^WEBUI_ADMIN_PASSWORD=admin$', 'WEBUI_ADMIN_PASSWORD=GENERATE_ON_FIRST_START'

foreach ($entry in $defaults.GetEnumerator()) {
    if ($content -notmatch "(?m)^$([regex]::Escape($entry.Key))=") {
        $content = $content.TrimEnd() + "`r`n$($entry.Key)=$($entry.Value)`r`n"
    }
}

if ($content -match '(?m)^WEBUI_ADMIN_PASSWORD=GENERATE_ON_FIRST_START$') {
    $passwordBytes = New-Object byte[] 12
    $passwordRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $passwordRng.GetBytes($passwordBytes)
    $passwordRng.Dispose()
    $passwordSuffix = ($passwordBytes | ForEach-Object { $_.ToString('x2') }) -join ''
    $adminPassword = "Ntp!9$passwordSuffix"
    $content = $content -replace '(?m)^WEBUI_ADMIN_PASSWORD=GENERATE_ON_FIRST_START$', "WEBUI_ADMIN_PASSWORD=$adminPassword"
    $credentialText = "Login: admin@nettap.local`r`nBootstrap password: $adminPassword`r`nGenerated UTC: $([DateTime]::UtcNow.ToString('o'))`r`n"
    [System.IO.File]::WriteAllText($bootstrapPasswordPath, $credentialText, [System.Text.UTF8Encoding]::new($false))
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
    '-f', $composeFile,
    '-f', $localComposeFile
)

$bootstrapCompose = $compose + @('-f', $bootstrapComposeFile)

docker @compose config --quiet
docker @bootstrapCompose pull
docker @bootstrapCompose up -d ollama

$ready = $false
foreach ($attempt in 1..90) {
    docker @bootstrapCompose exec -T ollama ollama list 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $ready = $true
        break
    }
    Start-Sleep -Seconds 2
}

if (-not $ready) {
    throw 'Ollama did not become ready within three minutes.'
}

docker @bootstrapCompose --profile initialize run --rm model-init
if ($LASTEXITCODE -ne 0) {
    throw 'NetTAP model initialization failed.'
}

docker @bootstrapCompose down
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to remove temporary registry-egress network.'
}

docker @compose up -d ollama open-webui assistant-launcher
docker @compose ps

$webPort = '3100'
$visibilityPort = '3000'
$packetPort = '3001'
foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
    if ($line -match '^WEB_PORT=(.+)$') {
        $webPort = $Matches[1]
    }
    if ($line -match '^VISIBILITY_LAUNCHER_PORT=(.+)$') {
        $visibilityPort = $Matches[1]
    }
    if ($line -match '^PACKET_EXPERT_LAUNCHER_PORT=(.+)$') {
        $packetPort = $Matches[1]
    }
}

Write-Host "NetTAP AI Suite: http://127.0.0.1:$webPort"
Write-Host "Network & Visibility: http://127.0.0.1:$visibilityPort"
Write-Host "Packet Expert: http://127.0.0.1:$packetPort"
Write-Host "Bootstrap credential file: $bootstrapPasswordPath"
Write-Host 'Immediately change the generated password in Settings > Account.'
Write-Host 'Then run finalize-admin.sh from WSL/Git Bash, or follow docs/AUTHENTICATION.md.'
Write-Host 'Existing Open WebUI volumes keep their existing accounts and passwords.'
