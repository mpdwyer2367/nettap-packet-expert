$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envPath = Join-Path $projectDir '.env'
$envExamplePath = Join-Path $projectDir '.env.example'
$composeFile = Join-Path $projectDir 'compose.yaml'
$localComposeFile = Join-Path $projectDir 'compose.local.yaml'
$bootstrapComposeFile = Join-Path $projectDir 'compose.bootstrap.yaml'
$bootstrapPasswordPath = Join-Path $projectDir '.bootstrap-admin-password'
$evidenceTokenPath = Join-Path $projectDir '.evidence-api-token'

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
    RELEASE_VERSION = '0.3.0-rc.5'
    OLLAMA_IMAGE = 'ollama/ollama:0.32.5'
    OPEN_WEBUI_IMAGE = 'ghcr.io/open-webui/open-webui:v0.11.0'
    CADDY_IMAGE = 'caddy:2.11.4-alpine'
    BACKUP_IMAGE = 'alpine:3.24.1'
    BASE_MODEL = 'qwen2.5:7b-instruct-q4_K_M'
    NETTAP_AI_MODEL = 'nettap-ai:0.3.0-rc.5'
    MODEL_NAME = 'nettap-ai:0.3.0-rc.5'
    EXPECTED_BASE_MODEL_ID = '845dbda0ea48'
    RETIRE_LEGACY_NETTAP_MODELS = 'true'
    NETTAP_VISIBILITY_PROFILE = 'nettap-network-visibility'
    NETTAP_PACKET_EXPERT_PROFILE = 'nettap-packet-expert'
    RAG_EMBEDDING_MODEL_ID = 'sentence-transformers/all-MiniLM-L6-v2'
    RAG_EMBEDDING_MODEL_REVISION = '1110a243fdf4706b3f48f1d95db1a4f5529b4d41'
    RAG_EMBEDDING_MODEL = '/app/backend/data/nettap-models/all-MiniLM-L6-v2/1110a243fdf4706b3f48f1d95db1a4f5529b4d41'
    BIND_ADDRESS = '127.0.0.1'
    WEB_PORT = '3100'
    VISIBILITY_LAUNCHER_PORT = '3000'
    PACKET_EXPERT_LAUNCHER_PORT = '3001'
    EVIDENCE_PORT = '3200'
    HTTPS_BIND_ADDRESS = '0.0.0.0'
    HTTPS_PORT = '8443'
    APPLIANCE_HOSTNAME = 'nettap-ai.local'
    JWT_EXPIRES_IN = '8h'
    OLLAMA_CPUS = '6'
    OLLAMA_MEMORY = '8g'
    WEBUI_CPUS = '2'
    WEBUI_MEMORY = '3g'
    EVIDENCE_CPUS = '1'
    EVIDENCE_MEMORY = '512m'
    EVIDENCE_MAX_UPLOAD_BYTES = '52428800'
    EVIDENCE_MAX_RECORDS = '100000'
    GATEWAY_CPUS = '1'
    GATEWAY_MEMORY = '512m'
    WEBUI_ADMIN_NAME = 'NetTAP Administrator'
    WEBUI_ADMIN_EMAIL = 'admin@nettap.local'
    WEBUI_ADMIN_PASSWORD = 'GENERATE_ON_FIRST_START'
    EVIDENCE_API_TOKEN = 'GENERATE_ON_FIRST_START'
    DEPLOYMENT_MODE = 'local'
}

$content = $content -replace '(?m)^RELEASE_VERSION=(0\.2\.0-rc\.1|0\.3\.0-rc\.[1234])$', 'RELEASE_VERSION=0.3.0-rc.5'
$content = $content -replace '(?m)^MODEL_NAME=(nettap-packet-expert:(0\.1\.0-rc\.8|0\.2\.0-rc\.1|0\.3\.0-rc\.1)|nettap-ai:(latest|0\.3\.0-rc\.[1234]))$', 'MODEL_NAME=nettap-ai:0.3.0-rc.5'
$content = $content -replace '(?m)^NETTAP_AI_MODEL=(nettap-packet-expert:[^\s]+|nettap-ai:(latest|0\.3\.0-rc\.[1234]))$', 'NETTAP_AI_MODEL=nettap-ai:0.3.0-rc.5'
$content = $content -replace '(?m)^RAG_EMBEDDING_MODEL=/app/backend/data/nettap-models/all-MiniLM-L6-v2$', 'RAG_EMBEDDING_MODEL=/app/backend/data/nettap-models/all-MiniLM-L6-v2/1110a243fdf4706b3f48f1d95db1a4f5529b4d41'
$content = $content -replace '(?m)^APPLIANCE_HOSTNAME=packet-expert\.local$', 'APPLIANCE_HOSTNAME=nettap-ai.local'
$content = $content -replace '(?m)^WEB_PORT=3001$', 'WEB_PORT=3100'
$content = $content -replace '(?m)^WEBUI_ADMIN_PASSWORD=admin$', 'WEBUI_ADMIN_PASSWORD=GENERATE_ON_FIRST_START'

foreach ($entry in $defaults.GetEnumerator()) {
    if ($content -notmatch "(?m)^$([regex]::Escape($entry.Key))=") {
        $content = $content.TrimEnd() + "`r`n$($entry.Key)=$($entry.Value)`r`n"
    }
}
$content = $content -replace '(?m)^DEPLOYMENT_MODE=production$', 'DEPLOYMENT_MODE=local'

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

if ($content -match '(?m)^EVIDENCE_API_TOKEN=GENERATE_ON_FIRST_START$') {
    $tokenBytes = New-Object byte[] 32
    $tokenRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $tokenRng.GetBytes($tokenBytes)
    $tokenRng.Dispose()
    $evidenceToken = ($tokenBytes | ForEach-Object { $_.ToString('x2') }) -join ''
    $content = $content -replace '(?m)^EVIDENCE_API_TOKEN=GENERATE_ON_FIRST_START$', "EVIDENCE_API_TOKEN=$evidenceToken"
    $tokenText = "Bearer token: $evidenceToken`r`nGenerated UTC: $([DateTime]::UtcNow.ToString('o'))`r`n"
    [System.IO.File]::WriteAllText($evidenceTokenPath, $tokenText, [System.Text.UTF8Encoding]::new($false))
    $evidenceToken = $null
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
if ($LASTEXITCODE -ne 0) {
    throw 'Docker Compose configuration is invalid.'
}
docker @bootstrapCompose pull
if ($LASTEXITCODE -ne 0) {
    throw 'Required container image pull failed.'
}
docker @bootstrapCompose up -d ollama
if ($LASTEXITCODE -ne 0) {
    docker @bootstrapCompose down 2>$null | Out-Null
    throw 'Ollama bootstrap service failed to start.'
}

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
    docker @bootstrapCompose down 2>$null | Out-Null
    throw 'Ollama did not become ready within three minutes.'
}

docker @bootstrapCompose --profile initialize run --rm model-init
if ($LASTEXITCODE -ne 0) {
    docker @bootstrapCompose down 2>$null | Out-Null
    throw 'NetTAP model initialization failed.'
}

docker @bootstrapCompose --profile initialize run --rm rag-cache-init
if ($LASTEXITCODE -ne 0) {
    docker @bootstrapCompose down 2>$null | Out-Null
    throw 'Pinned offline RAG model initialization failed.'
}

docker @bootstrapCompose down
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to remove temporary registry-egress network.'
}

docker @compose up -d ollama open-webui
if ($LASTEXITCODE -ne 0) {
    throw 'Open WebUI failed to start.'
}

$desiredFingerprint = (docker @compose --profile provision run --rm --no-deps assistant-provisioner --fingerprint | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($desiredFingerprint)) {
    throw 'Unable to calculate the assistant provisioning fingerprint.'
}
$actualFingerprint = (docker @compose exec -T open-webui python -c "import json; from pathlib import Path; p=Path('/app/backend/data/nettap-provisioning-state.json'); print(json.loads(p.read_text(encoding='utf-8')).get('fingerprint','') if p.is_file() else '')" | Out-String).Trim()

if ($actualFingerprint -ne $desiredFingerprint) {
    $adminPassword = ''
    foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
        if ($line -match '^WEBUI_ADMIN_PASSWORD=(.+)$') { $adminPassword = $Matches[1] }
    }
    if ([string]::IsNullOrWhiteSpace($adminPassword) -or $adminPassword -eq 'BOOTSTRAP_RETIRED' -or $adminPassword -eq 'GENERATE_ON_FIRST_START') {
        $securePassword = Read-Host 'Current Open WebUI administrator password' -AsSecureString
        $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        try {
            $adminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
        }
        finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
        }
    }
    $adminPassword | docker @compose --profile provision run --rm -T assistant-provisioner
    $adminPassword = $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Automatic assistant and offline RAG provisioning failed.'
    }
    $actualFingerprint = (docker @compose exec -T open-webui python -c "import json; from pathlib import Path; print(json.loads(Path('/app/backend/data/nettap-provisioning-state.json').read_text(encoding='utf-8')).get('fingerprint',''))" | Out-String).Trim()
    if ($actualFingerprint -ne $desiredFingerprint) {
        throw 'Assistant provisioning state does not match this release.'
    }
}

docker @compose up -d assistant-launcher evidence-service
if ($LASTEXITCODE -ne 0) {
    throw 'Assistant launcher or Evidence Workspace failed to start.'
}

$retireLegacy = 'true'
foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
    if ($line -match '^RETIRE_LEGACY_NETTAP_MODELS=(.+)$') { $retireLegacy = $Matches[1] }
}
if ($retireLegacy -match '^(?i:true|1|yes)$') {
    & (Join-Path $PSScriptRoot 'retire-legacy-models.ps1') -Confirm
} elseif ($retireLegacy -notmatch '^(?i:false|0|no)$') {
    throw "RETIRE_LEGACY_NETTAP_MODELS must be true or false; received: $retireLegacy"
}
docker @compose ps

$webPort = '3100'
$visibilityPort = '3000'
$packetPort = '3001'
$evidencePort = '3200'
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
    if ($line -match '^EVIDENCE_PORT=(.+)$') {
        $evidencePort = $Matches[1]
    }
}

Write-Host "NetTAP Network Intelligence: http://127.0.0.1:$webPort"
Write-Host "Network & Visibility: http://127.0.0.1:$visibilityPort"
Write-Host "Packet Expert: http://127.0.0.1:$packetPort"
Write-Host "Evidence Workspace: http://127.0.0.1:$evidencePort"
Write-Host "Evidence API token file: $evidenceTokenPath"
Write-Host "Bootstrap credential file: $bootstrapPasswordPath"
Write-Host 'Immediately change the generated password in Settings > Account.'
Write-Host 'Then run finalize-admin.sh from WSL/Git Bash, or follow docs/AUTHENTICATION.md.'
Write-Host 'Existing Open WebUI volumes keep their existing accounts and passwords.'
