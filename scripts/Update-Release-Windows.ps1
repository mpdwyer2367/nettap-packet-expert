[CmdletBinding()]
param([switch]$Confirm)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows-Common.ps1')
if (-not $Confirm) { throw 'Usage: .\scripts\Update-Release-Windows.ps1 -Confirm' }
Assert-Runtime
if (-not (Test-Path $EnvFile)) { throw 'Deploy and create the first administrator first.' }
& (Join-Path $ProjectDir 'tests\Static-Checks.ps1')
Invoke-Compose --profile initialize run --rm model-init
Invoke-Compose run --rm workspace-init --wait-timeout 30
Write-Host 'Release sources rebuilt and validated. Review git diff, commit, and push the source files.'
