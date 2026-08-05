Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows-Common.ps1')
Assert-Runtime
if (-not (Test-Path $EnvFile)) { throw 'Packet Expert has not been initialized.' }
Invoke-Compose ps
Invoke-Compose exec -T ollama ollama list
