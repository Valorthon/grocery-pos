#Requires -Version 5.1
<#
.SYNOPSIS
    Grocery POS single-PC installer bootstrap (#362).
.DESCRIPTION
    Run from the root of a prepared offline bundle, in an elevated Windows
    PowerShell. Verifies the bundle's own node.exe and installer scripts
    against bundle-manifest.json, then hands over to install.mjs, which
    verifies every other file, runs the preflight and performs the mode.
    Nothing is downloaded.
.EXAMPLE
    .\Install.ps1 -Mode install -AdminUsername owner
.EXAMPLE
    .\Install.ps1 -Mode repair
.EXAMPLE
    .\Install.ps1 -Mode uninstall
.EXAMPLE
    .\Install.ps1 -Mode handover-done
#>
[CmdletBinding()]
param(
    [ValidateSet('install', 'repair', 'uninstall', 'handover-done')]
    [string]$Mode = 'install',
    [string]$AdminUsername,
    [string]$StoreTimezone,
    [string]$BackupTime,
    [switch]$RemoveCaTrust
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Refused: run Windows PowerShell as an administrator.'
    exit 3
}

$bundle = $PSScriptRoot
$manifestPath = Join-Path $bundle 'bundle-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) {
    Write-Host 'Refused: this folder is not a Grocery POS bundle.'
    exit 3
}
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

# The code that runs next: node.exe and the packaging scripts. install.mjs
# then verifies the whole release before changing anything.
$checked = 0
foreach ($entry in $manifest.files.PSObject.Properties) {
    if ($entry.Name -notmatch '^release/(node/node\.exe|tools/.+)$') { continue }
    $path = Join-Path $bundle ($entry.Name -replace '/', '\')
    if (-not (Test-Path -LiteralPath $path)) {
        Write-Host "Refused: the bundle is missing $($entry.Name)."
        exit 3
    }
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
    if ($hash -ne $entry.Value) {
        Write-Host "Refused: $($entry.Name) does not match the bundle manifest."
        exit 3
    }
    $checked++
}
if ($checked -lt 2) {
    Write-Host 'Refused: the bundle manifest lists no installer files.'
    exit 3
}

$nodeArgs = @((Join-Path $bundle 'release\tools\installer\install.mjs'), $Mode)
if ($Mode -eq 'install' -or $Mode -eq 'repair') {
    $nodeArgs += @('--bundle', $bundle)
    if ($BackupTime) { $nodeArgs += @('--backup-time', $BackupTime) }
}
if ($Mode -eq 'install') {
    if ($AdminUsername) { $nodeArgs += @('--admin-username', $AdminUsername) }
    if ($StoreTimezone) { $nodeArgs += @('--store-timezone', $StoreTimezone) }
}
if ($Mode -eq 'uninstall' -and $RemoveCaTrust) { $nodeArgs += '--remove-ca-trust' }

$node = Join-Path $bundle 'release\node\node.exe'
& $node @nodeArgs
exit $LASTEXITCODE
