#Requires -Version 5.1
<#
.SYNOPSIS
    "Make terminal package" shortcut target (#397). Writes the package a
    LAN terminal joins with (terminal.mjs package): the public Caddy root
    (never its key), its SHA-256, the main PC's LAN address and
    JoinTerminal.ps1, into a folder the owner picks (a USB drive, say).
    It needs administrator rights (the root lives under tls\), so it asks
    for elevation through the normal Windows prompt.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$DataRoot,
    [Parameter(Mandatory = $true)][string]$Release
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$title = 'Grocery POS: Make terminal package'

function Show-Message([string]$Text, [string]$Icon = 'Information') {
    [void][System.Windows.Forms.MessageBox]::Show(
        $Text, $title,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::$Icon)
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    try {
        Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
            '-File', ('"' + $PSCommandPath + '"'),
            '-DataRoot', ('"' + $DataRoot + '"'),
            '-Release', ('"' + $Release + '"'))
    } catch {
        Show-Message 'Making a terminal package needs administrator permission. It was not started.' 'Warning'
    }
    exit 0
}

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose where to put the terminal package (for example a USB drive).'
if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }
$target = $dialog.SelectedPath

$node = Join-Path $Release 'node\node.exe'
$script = Join-Path $Release 'tools\installer\terminal.mjs'
$err = [System.IO.Path]::GetTempFileName()
$out = [System.IO.Path]::GetTempFileName()
try {
    $quoted = @($script, 'package', '--data-root', $DataRoot, '--to', $target) |
        ForEach-Object { '"' + ($_ -replace '(\\+)$', '$1$1') + '"' }
    $process = Start-Process -FilePath $node -ArgumentList $quoted -Wait -PassThru `
        -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
    $lines = @(Get-Content -LiteralPath $err | Where-Object { $_ -match '^(Refused: |Failed: )' })
    $done = @(Get-Content -LiteralPath $out | Where-Object { $_ -match '^Done: ' })
    $thumb = @(Get-Content -LiteralPath $out | Where-Object { $_ -match '^Root thumbprint: [0-9A-F]{40}$' })
} finally {
    Remove-Item -LiteralPath $out, $err -Force -ErrorAction SilentlyContinue
}
if ($process.ExitCode -ne 0) {
    $reason = 'The package tool reported an error.'
    if ($lines.Count) { $reason = $lines[-1] }
    Show-Message ("No terminal package was made.`n`n$reason") 'Error'
    exit 1
}
$folder = $target
if ($done.Count) { $folder = $done[-1].Substring(6) }
$fingerprint = ''
if ($thumb.Count) { $fingerprint = $thumb[-1].Substring(17) }
Show-Message ("Done. The terminal package is in:`n$folder`n`n" +
    "Certificate thumbprint: $fingerprint`n" +
    "Each terminal shows this thumbprint when it joins; compare it with this one.`n`n" +
    'On each terminal, copy the folder and follow README.txt in it.')
exit 0
