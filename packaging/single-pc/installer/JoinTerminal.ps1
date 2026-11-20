#Requires -Version 5.1
<#
.SYNOPSIS
    Joins a Windows terminal to the Grocery POS main PC (#397). Runs from
    the terminal package that "Make terminal package" wrote on the main PC
    (root.crt, terminal.json, this script). Needs administrator rights. No
    services and no Node on the terminal. The steps are joinPlan in
    terminal.mjs:

      join    verify root.crt's SHA-256, trust it (machine Root store, which
              Chrome on Windows honours), take Windows time from the main
              PC, create the "Grocery POS" Chrome shortcut, then check TLS
              with a plain GET of the site root.
      rejoin  the same, after deleting the previously trusted root by its
              recorded thumbprint (a new main PC or a new root).
      leave   delete only the recorded root and the shortcut.

    It never calls /v1/health*, which the LAN site refuses (#394).
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\JoinTerminal.ps1 -Mode join
#>
[CmdletBinding()]
param(
    [ValidateSet('join', 'rejoin', 'leave')]
    [string]$Mode = 'join'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 may default to older TLS; Caddy needs 1.2 or later.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Stop-Refused([string]$Text) {
    Write-Host "Refused: $Text Nothing was changed." -ForegroundColor Yellow
    exit 3
}
function Stop-Failed([string]$Text) {
    Write-Host "Failed: $Text" -ForegroundColor Red
    exit 1
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Stop-Refused 'Run this from an administrator PowerShell window.'
}

$here = Split-Path -Parent $PSCommandPath
$stateDir = Join-Path $env:ProgramData 'Valorthon\GroceryPOS-Terminal'
$stateFile = Join-Path $stateDir 'terminal.json'
$shortcuts = @(
    (Join-Path $env:PUBLIC 'Desktop\Grocery POS.lnk'),
    (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Grocery POS.lnk')
)

$recorded = $null
if (Test-Path -LiteralPath $stateFile) {
    $recorded = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    if ($recorded.thumbprint -notmatch '^[0-9A-F]{40}$') {
        Stop-Failed "$stateFile is damaged; remove the Grocery POS certificate by hand (certlm.msc) and delete that file."
    }
}

function Remove-Root([string]$Thumbprint) {
    & certutil.exe -delstore Root $Thumbprint | Out-Null
    if ($LASTEXITCODE -ne 0 -and (Test-Path -LiteralPath "Cert:\LocalMachine\Root\$Thumbprint")) {
        Stop-Failed "Could not remove the old Grocery POS certificate ($Thumbprint)."
    }
}

if ($Mode -eq 'leave') {
    if (-not $recorded) { Stop-Refused 'This terminal is not joined to a Grocery POS main PC.' }
    Remove-Root $recorded.thumbprint
    foreach ($link in $shortcuts) { Remove-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $stateFile -Force
    Write-Host 'Done. This terminal no longer trusts the main PC and its Grocery POS shortcut is gone.'
    exit 0
}

# ---------------------------------------------------------------- join/rejoin
$rootFile = Join-Path $here 'root.crt'
$infoFile = Join-Path $here 'terminal.json'
if (-not (Test-Path -LiteralPath $rootFile) -or -not (Test-Path -LiteralPath $infoFile)) {
    Stop-Refused 'root.crt or terminal.json is missing. Run this from the terminal package folder.'
}
$info = Get-Content -LiteralPath $infoFile -Raw | ConvertFrom-Json
if ($info.schema -ne 1 -or $info.port -ne 1443 -or
    $info.lanIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$' -or
    $info.serverUrl -ne ('https://' + $info.lanIp + ':1443') -or
    $info.rootSha256 -notmatch '^[0-9a-f]{64}$' -or
    $info.rootThumbprint -notmatch '^[0-9A-F]{40}$') {
    Stop-Refused 'terminal.json is not valid.'
}
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $rootFile).Hash.ToLowerInvariant()
if ($actual -ne $info.rootSha256) {
    Stop-Refused 'root.crt does not match this package (SHA-256 differs). Make a new terminal package on the main PC.'
}
$replacing = $recorded -and ($recorded.thumbprint -ne $info.rootThumbprint)
if ($Mode -eq 'join' -and $replacing) {
    Stop-Refused 'This terminal already trusts another Grocery POS root. Use -Mode rejoin to replace it.'
}

if ($replacing) { Remove-Root $recorded.thumbprint }

& certutil.exe -addstore -f Root $rootFile | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-Failed 'Could not add the Grocery POS certificate to the Windows Root store.' }

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
@{ thumbprint = $info.rootThumbprint; serverUrl = $info.serverUrl } |
    ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8

# Windows time from the main PC (its NTP server is #398). w32time is
# trigger-start on workgroup PCs, so it starts automatically from now on.
& sc.exe config w32time start= auto | Out-Null
Start-Service -Name w32time -ErrorAction SilentlyContinue
& w32tm.exe /config ('/manualpeerlist:' + $info.lanIp + ',0x8') /syncfromflags:manual /update | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-Failed 'Could not set Windows time to follow the main PC.' }
$timeWarning = ''
& w32tm.exe /resync /force | Out-Null
if ($LASTEXITCODE -ne 0) {
    $timeWarning = "`nWarning: the clock could not sync from the main PC yet. Check that the main PC is on; Windows retries by itself."
}

$chrome = $null
foreach ($hive in 'HKLM:', 'HKCU:') {
    $key = "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"
    $item = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
    if ($item -and $item.'(default)' -and (Test-Path -LiteralPath $item.'(default)')) {
        $chrome = $item.'(default)'
        break
    }
}
if (-not $chrome) { Stop-Failed 'Google Chrome is not installed. Install it, then run this again.' }
$url = $info.serverUrl + '/'
$shell = New-Object -ComObject WScript.Shell
foreach ($link in $shortcuts) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $link) | Out-Null
    $shortcut = $shell.CreateShortcut($link)
    $shortcut.TargetPath = $chrome
    $shortcut.Arguments = '--new-window ' + $url
    $shortcut.Description = 'Open Grocery POS in Google Chrome'
    $shortcut.Save()
}

# A plain GET of the site root over TLS checked against the Windows Root
# store: 200 means the main PC answers and its certificate is trusted.
try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 -Uri $url
    if ($response.StatusCode -ne 200) { throw "HTTP $($response.StatusCode)" }
} catch {
    Stop-Failed ("Joined, but the main PC did not answer securely at $url ($($_.Exception.Message)).`n" +
        'Check that the main PC is on, on the same network, and that its date and time are right; then run this again.')
}

Write-Host ("Done. This terminal trusts the main PC and opens Grocery POS at $url" + $timeWarning)
exit 0
