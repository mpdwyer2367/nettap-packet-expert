# NetTAP standalone live-capture agent for Windows.
# Capture only networks and interfaces you are authorized to monitor.

$ErrorActionPreference = "Stop"
$Endpoint = if ($env:NETTAP_ENDPOINT) { $env:NETTAP_ENDPOINT } else { "https://net-chat-insight.lovable.app/api/public/live-ingest" }
$SliceSeconds = if ($env:NETTAP_SLICE_SECONDS) { [int]$env:NETTAP_SLICE_SECONDS } else { 5 }
$CaptureFilter = if ($env:NETTAP_CAPTURE_FILTER) { $env:NETTAP_CAPTURE_FILTER } else { "" }
if ($SliceSeconds -le 0) { throw "NETTAP_SLICE_SECONDS must be a positive integer." }

$WiresharkPath = "C:\Program Files\Wireshark"
if (Test-Path $WiresharkPath) { $env:Path = "$WiresharkPath;$env:Path" }
foreach ($Command in @("dumpcap", "tshark")) {
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) { throw "$Command was not found. Install Wireshark with TShark and Npcap." }
}

Write-Host "Available capture interfaces:" -ForegroundColor Cyan
& dumpcap -D
if ($LASTEXITCODE -ne 0) { throw "dumpcap could not enumerate interfaces." }
$Interface = Read-Host "Enter the Windows interface number shown above"
if ($Interface -notmatch '^\d+$') { throw "Use the numeric interface identifier from dumpcap -D." }

$SecureToken = Read-Host "Paste the newly rotated NetTAP session token" -AsSecureString
$TokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
try { $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($TokenPointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($TokenPointer) }
if ([string]::IsNullOrWhiteSpace($Token)) { throw "A session token is required." }

$SpoolDirectory = Join-Path $env:TEMP ("nettap-live-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $SpoolDirectory | Out-Null
try {
    $TestCapture = Join-Path $SpoolDirectory "interface-test.pcapng"
    Write-Host "Testing interface $Interface for one second..." -ForegroundColor Cyan
    & dumpcap -i $Interface -a duration:1 -c 1 -w $TestCapture -q
    if ($LASTEXITCODE -ne 0) { throw "The interface test failed." }
    Remove-Item $TestCapture -Force -ErrorAction SilentlyContinue
    Write-Host "Capture started. Press Ctrl+C to stop." -ForegroundColor Green
    Write-Host "Decoded packet evidence is being sent to $Endpoint" -ForegroundColor Yellow

    while ($true) {
        $Timestamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
        $CaptureFile = Join-Path $SpoolDirectory "slice-$Timestamp.pcapng"
        $EkFile = Join-Path $SpoolDirectory "slice-$Timestamp.ndjson"
        $CaptureArguments = @("-i", $Interface, "-a", "duration:$SliceSeconds", "-w", $CaptureFile, "-q")
        if (-not [string]::IsNullOrWhiteSpace($CaptureFilter)) { $CaptureArguments += @("-f", $CaptureFilter) }
        & dumpcap @CaptureArguments
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $CaptureFile)) { throw "Capture failed." }

        $DecodedLines = @(& tshark -r $CaptureFile -T ek 2>$null)
        $DecodeExitCode = $LASTEXITCODE
        if ($DecodeExitCode -eq 0 -and $DecodedLines.Count -gt 0) {
            $Utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
            [IO.File]::WriteAllLines($EkFile, $DecodedLines, $Utf8WithoutBom)
        }
        if ($DecodeExitCode -ne 0 -or -not (Test-Path $EkFile) -or (Get-Item $EkFile).Length -eq 0) { throw "TShark decoding failed." }

        try {
            $Payload = [IO.File]::ReadAllBytes($EkFile)
            $Response = Invoke-RestMethod -Method Post -Uri $Endpoint -Body $Payload `
                -Headers @{ Authorization = "Bearer $Token" } -ContentType "application/x-ndjson" -TimeoutSec 30
            Write-Host ("Streamed {0} packets, session total {1}" -f $Response.packets, $Response.session_packets)
            Remove-Item $CaptureFile, $EkFile -Force -ErrorAction SilentlyContinue
        }
        catch { throw "Upload failed. Evidence retained in $SpoolDirectory. Error: $($_.Exception.Message)" }
    }
}
finally {
    $Token = $null
    Write-Host "Capture stopped. Review retained files in $SpoolDirectory before deleting them." -ForegroundColor Cyan
}

