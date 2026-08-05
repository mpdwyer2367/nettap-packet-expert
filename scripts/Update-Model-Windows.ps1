[CmdletBinding()]
param([switch]$Confirm)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows-Common.ps1')
if (-not $Confirm) { throw 'Usage: .\scripts\Update-Model-Windows.ps1 -Confirm' }
Write-Host 'This compatibility command now updates the complete release.'
& (Join-Path $PSScriptRoot 'Update-Release-Windows.ps1') -Confirm
