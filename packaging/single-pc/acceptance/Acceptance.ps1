#Requires -Version 5.1
<#
.SYNOPSIS
    Runs the read-only acceptance checks (acceptance.mjs, #366) on the
    Windows 11 x64 target and writes a new redacted evidence JSON.
    It installs, starts, stops and changes nothing. Run from an elevated
    Windows PowerShell in the source checkout's packaging\single-pc\acceptance
    folder (or a copy of it next to ..\runtime and ..\installer).

    NOT YET EXECUTED ON WINDOWS: parsed and reviewed statically only.

.EXAMPLE
    .\Acceptance.ps1 -Out D:\evidence\checks-1.json -Commit <40 hex>
    .\Acceptance.ps1 -Out D:\evidence\checks-2.json -Bundle C:\GroceryPOS-Setup -ManifestSha256 <hex>
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Out,
    [string]$Commit,
    [string]$Bundle,
    [string]$ManifestSha256,
    [string]$DataRoot = (Join-Path $env:ProgramData 'Valorthon\GroceryPOS')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error 'Run this from an elevated Windows PowerShell (secrets and ACLs are admin-only).'
    exit 2
}

# The installed release's own node.exe: no developer tooling on the target.
$state = Join-Path $DataRoot 'state\installer.json'
if (-not (Test-Path -LiteralPath $state)) {
    Write-Error "No installation record at $state. Install first (RUNBOOK B1)."
    exit 3
}
$installed = Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
$release = [string]$installed.release
$node = Join-Path $release 'node\node.exe'
if (-not (Test-Path -LiteralPath $node)) {
    Write-Error "Release node.exe not found at $node."
    exit 3
}

$arguments = @((Join-Path $PSScriptRoot 'acceptance.mjs'), '--out', $Out, '--data-root', $DataRoot, '--release', $release)
if ($Commit) { $arguments += @('--commit', $Commit) }
if ($Bundle) { $arguments += @('--bundle', $Bundle, '--manifest-sha256', $ManifestSha256) }
& $node @arguments
exit $LASTEXITCODE
