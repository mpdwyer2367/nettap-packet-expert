#Requires -RunAsAdministrator
<#
.SYNOPSIS
  AMDAI collector appliance installer for Windows.
.DESCRIPTION
  Idempotent: safe to re-run. Installs Npcap/Wireshark (dumpcap), PostgreSQL 16
  + TimescaleDB, registers amdai-collector / amdai-app as Windows services,
  opens flow-receiver firewall ports, applies the capacity profile, and
  prints pairing instructions.
.PARAMETER Profile
  small | medium | large | xl. Default: auto-detect from CPU/RAM/disk.
.PARAMETER ConsoleUrl
  AMDAI_CONSOLE_URL for the collector.
.PARAMETER Token
  AMDAI_COLLECTOR_TOKEN pairing token.
.PARAMETER Unattended
  Never prompt; fail instead of asking.
#>
[CmdletBinding()]
param(
  [ValidateSet('small','medium','large','xl')]
  [string]$Profile,
  [string]$ConsoleUrl,
  [string]$Token,
  [switch]$Unattended
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$AmdaiHome = 'C:\ProgramData\AMDAI'
$CollectorHome = Join-Path $AmdaiHome 'collector'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Log([string]$Message) { Write-Host "[amdai-install] $Message" }
function Write-Err([string]$Message) { Write-Host "[amdai-install][ERROR] $Message" -ForegroundColor Red }

function Assert-Admin {
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) { Write-Err 'Run this script from an elevated (Administrator) PowerShell.'; exit 1 }
}

function Get-DetectedProfile {
  $cpu = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
  $ramGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
  $diskGb = [math]::Round((Get-PSDrive -Name (Split-Path $AmdaiHome -Qualifier).TrimEnd(':')).Free / 1GB + (Get-PSDrive -Name (Split-Path $AmdaiHome -Qualifier).TrimEnd(':')).Used / 1GB)
  Write-Log "Detected: $cpu vCPU, $ramGb GB RAM, $diskGb GB disk"

  # Thresholds mirror src/lib/capacity.ts CAPACITY_PROFILES[*].requires (10% tolerance).
  if ($cpu -ge 32 -and $ramGb -ge 115 -and $diskGb -ge 3600) { return 'xl' }
  elseif ($cpu -ge 16 -and $ramGb -ge 58 -and $diskGb -ge 1800) { return 'large' }
  elseif ($cpu -ge 8 -and $ramGb -ge 29 -and $diskGb -ge 900) { return 'medium' }
  else { return 'small' }
}

function Confirm-OrExit([string]$Prompt) {
  if ($Unattended) { return }
  $reply = Read-Host "$Prompt [y/N]"
  if ($reply -notmatch '^(y|yes)$') { Write-Err 'Aborted by operator.'; exit 1 }
}

function Install-Npcap {
  Write-Log 'Installing Npcap + Wireshark CLI (dumpcap) via winget.'
  $wingetOk = Get-Command winget -ErrorAction SilentlyContinue
  if ($wingetOk) {
    winget install --id WiresharkFoundation.Wireshark -e --silent --accept-source-agreements --accept-package-agreements 2>$null
  } else {
    Write-Log 'winget not found. Manual step required:'
    Write-Log '  Download and install Wireshark (bundles Npcap) from https://www.wireshark.org/download.html'
    Write-Log '  During Npcap setup, check "Support raw 802.11 traffic" and "Install Npcap in WinPcap API-compatible Mode" as needed.'
    Confirm-OrExit 'Continue assuming Wireshark/Npcap/dumpcap.exe is already installed?'
  }
}

function Install-Postgres {
  $pgService = Get-Service -Name 'postgresql-x64-16' -ErrorAction SilentlyContinue
  if ($pgService) { Write-Log 'PostgreSQL 16 service already present.'; return }
  $wingetOk = Get-Command winget -ErrorAction SilentlyContinue
  if ($wingetOk) {
    Write-Log 'Installing PostgreSQL 16 via winget.'
    winget install --id PostgreSQL.PostgreSQL.16 -e --silent --accept-source-agreements --accept-package-agreements 2>$null
  } else {
    Write-Log 'winget not found. Manual step required:'
    Write-Log '  Download the PostgreSQL 16 installer (EDB) from https://www.postgresql.org/download/windows/'
    Write-Log '  During install, note the superuser password and default port (5432).'
    Confirm-OrExit 'Continue assuming PostgreSQL 16 is already installed and running?'
  }
  Write-Log 'Install TimescaleDB for Windows manually: https://docs.timescale.com/self-hosted/latest/install/installation-windows/'
  Write-Log '  (this must be run interactively once per PostgreSQL install; not automatable via winget.)'
}

function New-AmdaiDatabase {
  $psql = Get-Command psql -ErrorAction SilentlyContinue
  if (-not $psql) {
    Write-Err 'psql not found on PATH; add PostgreSQL bin dir to PATH and re-run, or create the amdai_collector DB manually.'
    return $null
  }
  $dbPassword = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object {[char]$_})
  $sql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'amdai') THEN
    CREATE ROLE amdai LOGIN PASSWORD '$dbPassword';
  ELSE
    ALTER ROLE amdai WITH PASSWORD '$dbPassword';
  END IF;
END
`$`$;
SELECT 'CREATE DATABASE amdai_collector OWNER amdai'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'amdai_collector')\gexec
"@
  $env:PGPASSWORD = ''
  $sql | & psql -U postgres -h 127.0.0.1 -v ON_ERROR_STOP=1 2>$null
  & psql -U postgres -h 127.0.0.1 -d amdai_collector -c 'CREATE EXTENSION IF NOT EXISTS timescaledb;' 2>$null
  return $dbPassword
}

function Open-FirewallPorts {
  Write-Log 'Opening flow-receiver inbound ports (2055/4739/6343 UDP) and SNMP/WinRM outbound.'
  $rules = @(
    @{Name='AMDAI NetFlow (2055/UDP)'; Port=2055; Protocol='UDP'; Direction='Inbound'}
    @{Name='AMDAI IPFIX (4739/UDP)'; Port=4739; Protocol='UDP'; Direction='Inbound'}
    @{Name='AMDAI sFlow (6343/UDP)'; Port=6343; Protocol='UDP'; Direction='Inbound'}
    @{Name='AMDAI SNMP (161/UDP outbound)'; Port=161; Protocol='UDP'; Direction='Outbound'}
  )
  foreach ($r in $rules) {
    if (-not (Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName $r.Name -Direction $r.Direction -Protocol $r.Protocol -LocalPort $r.Port -Action Allow | Out-Null
    }
  }
  # WinRM (5985/5986) is required if AMDAI polls this box's own facts over WinRM.
  if (Get-Command Enable-PSRemoting -ErrorAction SilentlyContinue) {
    Enable-PSRemoting -Force -SkipNetworkProfileCheck | Out-Null
  }
}

function Register-AmdaiServices {
  param([string]$ProfileName, [string]$ConsoleUrlValue, [string]$TokenValue, [string]$LocalPg)

  New-Item -ItemType Directory -Force -Path $CollectorHome | Out-Null
  $repoCollectorDir = Split-Path -Parent $ScriptDir
  Copy-Item -Path (Join-Path $repoCollectorDir '*') -Destination $CollectorHome -Recurse -Force -Exclude @('node_modules','data','config')

  $envFile = Join-Path $AmdaiHome 'collector.env'
  @"
AMDAI_PROFILE=$ProfileName
AMDAI_CONSOLE_URL=$ConsoleUrlValue
AMDAI_COLLECTOR_TOKEN=$TokenValue
AMDAI_LOCAL_PG=$LocalPg
AMDAI_API_PORT=8787
"@ | Set-Content -Path $envFile -Encoding ascii

  Push-Location $CollectorHome
  npm ci --omit=dev
  npm run build
  Pop-Location

  $nssm = Get-Command nssm -ErrorAction SilentlyContinue
  $nodeExe = (Get-Command node).Source
  $entry = Join-Path $CollectorHome 'dist\index.js'

  if (Get-Service -Name amdai-collector -ErrorAction SilentlyContinue) {
    Stop-Service amdai-collector -ErrorAction SilentlyContinue
    if ($nssm) { & nssm remove amdai-collector confirm | Out-Null } else { sc.exe delete amdai-collector | Out-Null }
  }

  if ($nssm) {
    Write-Log 'Registering amdai-collector via nssm (recommended: env file + restart-on-crash support).'
    & nssm install amdai-collector $nodeExe $entry
    & nssm set amdai-collector AppEnvironmentExtra "AMDAI_PROFILE=$ProfileName" "AMDAI_CONSOLE_URL=$ConsoleUrlValue" "AMDAI_COLLECTOR_TOKEN=$TokenValue" "AMDAI_LOCAL_PG=$LocalPg" "AMDAI_API_PORT=8787"
    & nssm set amdai-collector AppDirectory $CollectorHome
    & nssm set amdai-collector Start SERVICE_AUTO_START
    & nssm start amdai-collector
  } else {
    Write-Log 'nssm not found; registering with New-Service (no automatic env-file reload; env baked at install time).'
    $binPath = "`"$nodeExe`" `"$entry`""
    New-Service -Name amdai-collector -BinaryPathName $binPath -DisplayName 'AMDAI Collector' -StartupType Automatic
    Start-Service amdai-collector
  }
}

function Show-PairingInstructions {
  param([string]$ProfileName, [string]$ConsoleUrlValue)
  Write-Host ''
  Write-Host '============================================================================='
  Write-Host 'AMDAI collector installed successfully.'
  Write-Host "  Profile:     $ProfileName"
  Write-Host "  Console URL: $(if ($ConsoleUrlValue) { $ConsoleUrlValue } else { '<not set - edit C:\ProgramData\AMDAI\collector.env>' })"
  Write-Host '  Service:     Get-Service amdai-collector'
  Write-Host ''
  Write-Host 'Next steps:'
  Write-Host '  1. In the AMDAI console, go to Collectors -> Add Collector to issue a pairing token.'
  Write-Host '  2. Confirm the collector goes "online" within about a minute.'
  Write-Host '  3. Point NetFlow/IPFIX/sFlow exporters or an NPB SPAN/TAP port at this host.'
  Write-Host '  4. Re-run this script any time; it is safe to repeat.'
  Write-Host '============================================================================='
}

Assert-Admin
if (-not $Profile) { $Profile = Get-DetectedProfile }
Write-Log "Selected capacity profile: $Profile"
Confirm-OrExit "Install AMDAI collector with profile '$Profile'?"

Install-Npcap
Install-Postgres
$dbPassword = New-AmdaiDatabase
$localPg = if ($dbPassword) { "postgresql://amdai:$dbPassword@127.0.0.1:5432/amdai_collector" } else { 'postgresql://amdai:CHANGE_ME@127.0.0.1:5432/amdai_collector' }
Open-FirewallPorts
Register-AmdaiServices -ProfileName $Profile -ConsoleUrlValue $ConsoleUrl -TokenValue $Token -LocalPg $localPg
Show-PairingInstructions -ProfileName $Profile -ConsoleUrlValue $ConsoleUrl
