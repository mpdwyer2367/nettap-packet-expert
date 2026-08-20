[CmdletBinding()]
param(
    [switch]$ConfirmDownload
)

$ErrorActionPreference = 'Stop'
$BaseModel = 'qwen3.5:9b-q4_K_M'
$ExpectedBaseId = '6488c96fa5fa'
$ModelName = 'nettap-ai:0.4.0-rc.1'
$ProjectDirectory = Split-Path -Parent $PSScriptRoot
$Modelfile = Join-Path $ProjectDirectory 'model/nettap-ai.Modelfile'

if (-not $ConfirmDownload) {
    throw "Run .\scripts\install-model-native.ps1 -ConfirmDownload to authorize the pinned base-model download."
}
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    throw 'Ollama is required and was not found on PATH. Install and start Ollama, then retry.'
}
if (-not (Test-Path -LiteralPath $Modelfile -PathType Leaf)) {
    throw "Missing Modelfile: $Modelfile"
}

& ollama list | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'The Ollama service is not reachable. Start Ollama and retry.' }

Write-Host "Downloading approved base model: $BaseModel"
& ollama pull $BaseModel
if ($LASTEXITCODE -ne 0) { throw "Ollama could not download $BaseModel." }

$BaseLine = (& ollama list | Select-String -Pattern "^$([regex]::Escape($BaseModel))\s+" | Select-Object -First 1).Line
if (-not $BaseLine) { throw "Ollama did not list $BaseModel after download." }
$ActualBaseId = ($BaseLine -split '\s+')[1]
if ($ActualBaseId -ne $ExpectedBaseId) {
    throw "Base-model identity mismatch: expected $ExpectedBaseId, received $ActualBaseId."
}

Write-Host "Creating NetTAP Network Intelligence Model: $ModelName"
& ollama create $ModelName -f $Modelfile
if ($LASTEXITCODE -ne 0) { throw "Ollama could not create $ModelName." }
$Rendered = (& ollama show --modelfile $ModelName) -join "`n"
foreach ($RequiredText in @('You are the NetTAP Network Intelligence Model', 'Network & Visibility mode', 'Packet Expert mode')) {
    if (-not $Rendered.Contains($RequiredText)) { throw "Combined model verification is missing: $RequiredText" }
}

$installedModels = @(& ollama list | Select-Object -Skip 1 | ForEach-Object { ($_ -split '\s+')[0] })
foreach ($InstalledModel in $installedModels) {
    $isNetTAP = (
        $InstalledModel -like 'nettap-ai:*' -or
        $InstalledModel -like 'nettap-ai-backup-*' -or
        $InstalledModel -like 'nettap-packet-expert:*' -or
        $InstalledModel -like 'nettap-network-visibility:*'
    )
    if ($isNetTAP -and $InstalledModel -ne $ModelName) {
        & ollama rm $InstalledModel
        if ($LASTEXITCODE -ne 0) { throw "Unable to retire superseded NetTAP model: $InstalledModel" }
    }
}
$remainingLegacy = @(& ollama list | Select-Object -Skip 1 | ForEach-Object { ($_ -split '\s+')[0] } | Where-Object {
    $_ -ne $ModelName -and ($_ -like 'nettap-ai:*' -or $_ -like 'nettap-ai-backup-*' -or $_ -like 'nettap-packet-expert:*' -or $_ -like 'nettap-network-visibility:*')
})
if ($remainingLegacy.Count -gt 0) { throw "Superseded native NetTAP tags remain: $($remainingLegacy -join ', ')" }

Write-Host "PASS: $ModelName is saved in the active Ollama store."
Write-Host 'PASS: superseded native NetTAP model tags were retired.'
Write-Host "Run it directly with: ollama run $ModelName"
Write-Host 'For both branded assistants, offline RAG, accounts, and launchers, use the full Docker deployment in README.md.'
