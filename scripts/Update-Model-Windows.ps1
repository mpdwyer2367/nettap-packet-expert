[CmdletBinding()]
param([switch]$Confirm)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows-Common.ps1')
if (-not $Confirm) { throw 'Usage: .\scripts\Update-Model-Windows.ps1 -Confirm' }
Assert-Runtime
if (-not (Test-Path $EnvFile)) { throw 'Run Start-Windows.ps1 first.' }
Invoke-Compose --profile initialize run --rm model-init
Write-Host 'Model rebuilt. Run .\tests\Windows-E2E.ps1 before publishing a release.'
