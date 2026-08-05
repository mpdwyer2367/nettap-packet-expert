Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:EnvFile = Join-Path $script:ProjectDir '.env'
$script:ComposeFile = Join-Path $script:ProjectDir 'compose.yaml'

function Assert-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "Required command not found: $Name" }
}

function Assert-Runtime {
    Assert-Command 'docker'
    & docker compose version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose v2 is required.' }
    & docker info | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is installed but its engine is not running.' }
    $osType = (& docker info --format '{{.OSType}}').Trim()
    if ($osType -ne 'linux') { throw 'Docker Desktop must be using Linux containers.' }
}

function Initialize-Environment {
    if (-not (Test-Path $script:EnvFile)) { Copy-Item (Join-Path $script:ProjectDir '.env.example') $script:EnvFile }
    $content = Get-Content $script:EnvFile -Raw
    if ($content -match '(?m)^WEBUI_SECRET_KEY=GENERATE_ON_FIRST_START\s*$') {
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $secret = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
        $content = $content -replace '(?m)^WEBUI_SECRET_KEY=GENERATE_ON_FIRST_START\s*$', "WEBUI_SECRET_KEY=$secret"
        [IO.File]::WriteAllText($script:EnvFile, $content, (New-Object Text.UTF8Encoding($false)))
        $secret = $null
    }
}

function Get-EnvironmentValue([string]$Name) {
    $line = Get-Content $script:EnvFile | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -Last 1
    if (-not $line) { throw "Missing $Name in .env" }
    return ($line -split '=', 2)[1]
}

function Invoke-Compose {
    & docker compose --project-directory $script:ProjectDir --env-file $script:EnvFile -f $script:ComposeFile @args
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed with exit code $LASTEXITCODE." }
}
