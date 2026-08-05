Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$required = @('compose.yaml', '.env.example', 'model\Modelfile', 'scripts\Start-Windows.ps1', 'scripts\Windows-Common.ps1', 'scripts\Update-Release-Windows.ps1', 'docs\MACOS_DEPLOYMENT.md', 'docs\WINDOWS_DEPLOYMENT.md', 'docs\MODEL_LIFECYCLE.md', 'docs\LEGAL_AND_DATA_HANDLING.md', 'workspace\provision.py', 'workspace\skills\manifest.json', 'knowledge\manifest.json', 'tests\retrieval-e2e.sh')
foreach ($relative in $required) { if (-not (Test-Path (Join-Path $projectDir $relative))) { throw "Missing required file: $relative" } }
$composeText = Get-Content (Join-Path $projectDir 'compose.yaml') -Raw
$envExample = Get-Content (Join-Path $projectDir '.env.example') -Raw
$modelText = Get-Content (Join-Path $projectDir 'model\Modelfile') -Raw
if ($modelText -notmatch '(?m)^FROM qwen2\.5:7b-instruct-q4_K_M$') { throw 'Unexpected base model.' }
if ($composeText -notmatch 'ENABLE_CODE_EXECUTION: "False"') { throw 'Code execution must be disabled.' }
if ($composeText -notmatch 'internal: true') { throw 'Internal backend network is missing.' }
if ($composeText -notmatch 'workspace-init:') { throw 'Workspace initializer is missing.' }
if ($envExample -notmatch '(?m)^BIND_ADDRESS=127\.0\.0\.1$') { throw 'Default bind address must be loopback.' }
. (Join-Path $projectDir 'scripts\Windows-Common.ps1')
if (-not (Test-Path $EnvFile)) { Copy-Item (Join-Path $projectDir '.env.example') $EnvFile; $createdEnv = $true } else { $createdEnv = $false }
try {
    & docker compose --project-directory $ProjectDir --env-file $EnvFile -f $ComposeFile config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose configuration validation failed.' }
} finally { if ($createdEnv) { Remove-Item $EnvFile } }
Write-Host 'Windows static checks passed.'
