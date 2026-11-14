#Requires -Version 5.1
<#
.SYNOPSIS
    Grocery POS shortcut target (#362): waits until the app is actually
    ready (the proxy's /v1/health/ready, which needs the API and the
    database), then opens it in Google Chrome. Runs as the logged-on user,
    without elevation. The Chrome profile is the user's own; this script
    never changes it.
#>
[CmdletBinding()]
param(
    [string]$Origin = 'https://localhost:1443',
    [int]$TimeoutSeconds = 180
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

# Windows PowerShell 5.1 may default to older TLS; Caddy needs 1.2 or later.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Show-Problem([string]$Text) {
    [void][System.Windows.Forms.MessageBox]::Show(
        $Text, 'Grocery POS',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning)
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri "$Origin/v1/health/ready"
        if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {
        # Not listening yet, starting up, or the database is still recovering.
    }
    Start-Sleep -Seconds 2
}
if (-not $ready) {
    Show-Problem ("Grocery POS did not become ready within $TimeoutSeconds seconds.`n`n" +
        'Wait a minute and open it again. If it still does not start, restart ' +
        'the computer, then contact your vendor.')
    exit 1
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
if (-not $chrome) {
    Show-Problem 'Google Chrome is not installed. Grocery POS opens in Google Chrome; contact your vendor.'
    exit 1
}
Start-Process -FilePath $chrome -ArgumentList @('--new-window', "$Origin/")
exit 0
