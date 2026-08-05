Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows-Common.ps1')
Assert-Runtime
if (-not (Test-Path $EnvFile)) { Write-Host 'Packet Expert has not been initialized.'; exit 0 }
Invoke-Compose down
Write-Host 'Packet Expert stopped. Persistent volumes were preserved.'
