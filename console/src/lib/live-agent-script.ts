/**
 * Generates the local capture agent script for a live session.
 *
 * The script is intentionally dependency-free: it only uses dumpcap + tshark
 * (already installed with Wireshark) and curl / PowerShell. The session token is
 * read from an environment variable so it never lands in shell history or logs.
 */

import type { CaptureOs } from "./live-capture-types";

export type AgentScriptOptions = {
  os: CaptureOs;
  endpoint: string;
  interfaceName: string;
  captureFilter?: string | null;
  sliceSeconds: number;
};

export function agentTokenEnvName() {
  return "NETTAP_TOKEN";
}

export function generateAgentScript({
  os,
  endpoint,
  interfaceName,
  captureFilter,
  sliceSeconds,
}: AgentScriptOptions): string {
  const filter = (captureFilter ?? "").trim();

  if (os === "windows") {
    return `# NetTAP.AI live capture agent (Windows / Npcap)
# 1. Install Wireshark + Npcap (enable "WinPcap API-compatible mode").
# 2. Run this in an *elevated* PowerShell window.
# 3. Stop it any time with Ctrl+C.

$env:NETTAP_TOKEN = "<paste-session-token>"
$Endpoint  = "${endpoint}"
$Interface = "${interfaceName}"
$Slice     = ${sliceSeconds}
$Filter    = "${filter.replace(/"/g, '""')}"

$wireshark = "C:\\Program Files\\Wireshark"
if (Test-Path $wireshark) { $env:Path = "$wireshark;$env:Path" }

Write-Host "Available interfaces:" -ForegroundColor Cyan
dumpcap -D

$tmp = Join-Path $env:TEMP "nettap-live"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

while ($true) {
  $pcap = Join-Path $tmp "slice.pcapng"
  $args = @("-i", $Interface, "-a", "duration:$Slice", "-w", $pcap, "-q")
  if ($Filter) { $args += @("-f", $Filter) }
  & dumpcap @args 2>$null

  if (Test-Path $pcap) {
    $ek = & tshark -r $pcap -T ek 2>$null | Out-String
    Remove-Item $pcap -Force -ErrorAction SilentlyContinue
    if ($ek.Trim()) {
      try {
        $resp = Invoke-RestMethod -Method Post -Uri $Endpoint -Body ([Text.Encoding]::UTF8.GetBytes($ek)) \`
          -Headers @{ Authorization = "Bearer $($env:NETTAP_TOKEN)" } -ContentType "application/x-ndjson"
        Write-Host ("streamed {0} packets (total {1})" -f $resp.packets, $resp.session_packets)
      } catch {
        Write-Warning "upload failed: $($_.Exception.Message) - retrying next slice"
        Start-Sleep -Seconds 3
      }
    }
  } else {
    Write-Warning "dumpcap produced no slice - check the interface name and that PowerShell is elevated."
    Start-Sleep -Seconds 3
  }
}
`;
  }

  const sudo = os === "linux" ? "" : "";
  return `#!/usr/bin/env bash
# NetTAP.AI live capture agent (${os === "macos" ? "macOS" : "Linux"} / libpcap)
# Requires Wireshark CLI tools (dumpcap + tshark) on PATH.
# Stop any time with Ctrl+C.
set -uo pipefail

export NETTAP_TOKEN="\${NETTAP_TOKEN:-<paste-session-token>}"
ENDPOINT="${endpoint}"
IFACE="${interfaceName}"
SLICE=${sliceSeconds}
FILTER='${filter.replace(/'/g, "'\\''")}'

echo "Available interfaces:"; ${sudo}dumpcap -D || true

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

while true; do
  if [ -n "$FILTER" ]; then
    ${sudo}dumpcap -i "$IFACE" -a "duration:$SLICE" -w "$TMP/slice.pcapng" -q -f "$FILTER" 2>/dev/null
  else
    ${sudo}dumpcap -i "$IFACE" -a "duration:$SLICE" -w "$TMP/slice.pcapng" -q 2>/dev/null
  fi

  if [ ! -s "$TMP/slice.pcapng" ]; then
    echo "dumpcap produced no slice - check the interface name and capture permissions." >&2
    sleep 3
    continue
  fi

  tshark -r "$TMP/slice.pcapng" -T ek > "$TMP/slice.ek" 2>/dev/null
  rm -f "$TMP/slice.pcapng"

  if [ -s "$TMP/slice.ek" ]; then
    if ! curl -sS -X POST "$ENDPOINT" \\
      -H "Authorization: Bearer $NETTAP_TOKEN" \\
      -H "Content-Type: application/x-ndjson" \\
      --data-binary @"$TMP/slice.ek"; then
      echo "upload failed - retrying next slice" >&2
      sleep 3
    fi
    echo
  fi
done
`;
}
