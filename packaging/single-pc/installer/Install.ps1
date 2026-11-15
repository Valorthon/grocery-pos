#Requires -Version 5.1
<#
.SYNOPSIS
    Grocery POS single-PC installer bootstrap (#362).
.DESCRIPTION
    Run from the root of a prepared offline bundle, in an elevated Windows
    PowerShell. -ManifestSha256 is the bundle-manifest.json SHA-256 that
    bundle.mjs printed on the vendor's build machine, compared out of band
    (the manifest travels with the files it describes, so it alone only
    detects corruption). Nothing is executed from the bundle folder itself,
    which may be user-writable (USB stick, Downloads): node\ and tools\ are
    copied into a fresh folder under %ProgramFiles% (administrators only),
    unlisted files are refused, every file is verified there, and the copy
    runs install.mjs, which verifies the release before changing anything.
    Nothing is downloaded.
.EXAMPLE
    .\Install.ps1 -ManifestSha256 <hash> -Mode install -AdminUsername owner
.EXAMPLE
    .\Install.ps1 -ManifestSha256 <hash> -Mode repair
.EXAMPLE
    .\Install.ps1 -ManifestSha256 <hash> -Mode uninstall
.EXAMPLE
    .\Install.ps1 -ManifestSha256 <hash> -Mode handover-done
.EXAMPLE
    .\Install.ps1 -ManifestSha256 <hash> -Mode upgrade
.EXAMPLE
    .\Install.ps1 -ManifestSha256 <hash> -Mode upgrade-rollback -RestoreBackup <pre-upgrade backup id>
.EXAMPLE
    .\Install.ps1 -ManifestSha256 <hash> -Mode upgrade-status
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ManifestSha256,
    [ValidateSet('install', 'repair', 'uninstall', 'handover-done',
        'upgrade', 'upgrade-rollback', 'upgrade-status')]
    [string]$Mode = 'install',
    [string]$AdminUsername,
    [string]$StoreTimezone,
    [string]$BackupTime,
    [switch]$RemoveCaTrust,
    [ValidatePattern('^[0-9A-Za-z-]{1,80}$')]
    [string]$RestoreBackup,
    [switch]$AcceptNewerSales
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-Refused([string]$Text) {
    Write-Host "Refused: $Text"
    exit 3
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Stop-Refused 'run Windows PowerShell as an administrator.'
}
# Mode-specific options are refused elsewhere, never silently ignored.
if (($RestoreBackup -or $AcceptNewerSales) -and $Mode -ne 'upgrade-rollback') {
    Stop-Refused '-RestoreBackup and -AcceptNewerSales only go with -Mode upgrade-rollback.'
}
if ($AcceptNewerSales -and -not $RestoreBackup) {
    Stop-Refused '-AcceptNewerSales only goes with -RestoreBackup.'
}

$bundle = $PSScriptRoot
$manifestPath = Join-Path $bundle 'bundle-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) {
    Stop-Refused 'this folder is not a Grocery POS bundle.'
}
# Read once: the bytes that were hashed are the bytes that are parsed.
$manifestBytes = [System.IO.File]::ReadAllBytes($manifestPath)
$sha = [System.Security.Cryptography.SHA256]::Create()
$manifestHash = ([System.BitConverter]::ToString($sha.ComputeHash($manifestBytes)) -replace '-', '').ToLowerInvariant()
if ($manifestHash -ne $ManifestSha256.ToLowerInvariant()) {
    Stop-Refused ("bundle-manifest.json has SHA-256 $manifestHash, not the one the vendor " +
        'recorded. Do not install this bundle; rebuild or recopy it.')
}
$manifest = [System.Text.Encoding]::UTF8.GetString($manifestBytes) | ConvertFrom-Json

# Expected files of the code that runs: release/node/** and release/tools/**.
$expected = @{}
foreach ($entry in $manifest.files.PSObject.Properties) {
    if ($entry.Name -match '^release/(node|tools)/(.+)$') {
        $expected[$entry.Name.Substring('release/'.Length)] = $entry.Value
    }
}
if (-not $expected.ContainsKey('node/node.exe') -or
    -not $expected.ContainsKey('tools/installer/install.mjs')) {
    Stop-Refused 'the bundle manifest lists no installer.'
}

# A fresh folder under Program Files: only administrators and SYSTEM can
# write there, so nothing can change between verification and execution.
$programDir = Join-Path $env:ProgramFiles 'Valorthon\GroceryPOS'
$run = Join-Path $programDir ('installer-run-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $run -Force | Out-Null
$code = 1
try {
    foreach ($part in 'node', 'tools') {
        Copy-Item -LiteralPath (Join-Path $bundle "release\$part") -Destination $run -Recurse
    }
    $seen = 0
    foreach ($file in Get-ChildItem -LiteralPath $run -Recurse -File -Force) {
        $relative = $file.FullName.Substring($run.Length + 1) -replace '\\', '/'
        if (-not $expected.ContainsKey($relative)) {
            throw "REFUSED:the bundle holds an unlisted file: release/$relative"
        }
        $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
        if ($hash -ne $expected[$relative]) {
            throw "REFUSED:release/$relative does not match the bundle manifest."
        }
        $seen++
    }
    if ($seen -ne $expected.Count) {
        throw 'REFUSED:the bundle is missing installer files.'
    }

    # Upgrades (#364) run the new bundle's upgrade tool from the same
    # verified copy; it re-verifies the whole release itself.
    $upgradeCommands = @{ 'upgrade' = 'upgrade'; 'upgrade-rollback' = 'rollback'; 'upgrade-status' = 'status' }
    if ($upgradeCommands.ContainsKey($Mode)) {
        if (-not $expected.ContainsKey('tools/upgrade/upgrade.mjs')) {
            throw 'REFUSED:this bundle has no upgrade tool.'
        }
        $nodeArgs = @((Join-Path $run 'tools\upgrade\upgrade.mjs'), $upgradeCommands[$Mode])
    } else {
        $nodeArgs = @((Join-Path $run 'tools\installer\install.mjs'), $Mode)
    }
    if ($Mode -eq 'upgrade-rollback' -and $RestoreBackup) {
        $nodeArgs += @('--restore-backup', $RestoreBackup)
        if ($AcceptNewerSales) { $nodeArgs += '--accept-newer-sales' }
    }
    if ($Mode -eq 'install' -or $Mode -eq 'repair' -or $Mode -eq 'upgrade') {
        # The manifest bytes already checked against -ManifestSha256, written
        # into the admin-only run folder; install.mjs never reads the bundle's.
        $verifiedManifest = Join-Path $run 'bundle-manifest.json'
        [System.IO.File]::WriteAllBytes($verifiedManifest, $manifestBytes)
        $nodeArgs += @('--bundle', $bundle, '--manifest', $verifiedManifest,
            '--manifest-sha256', $manifestHash)
        if ($BackupTime -and $Mode -ne 'upgrade') { $nodeArgs += @('--backup-time', $BackupTime) }
    }
    if ($Mode -eq 'install') {
        if ($AdminUsername) { $nodeArgs += @('--admin-username', $AdminUsername) }
        if ($StoreTimezone) { $nodeArgs += @('--store-timezone', $StoreTimezone) }
    }
    if ($Mode -eq 'uninstall' -and $RemoveCaTrust) { $nodeArgs += '--remove-ca-trust' }

    & (Join-Path $run 'node\node.exe') @nodeArgs
    $code = $LASTEXITCODE
} catch {
    # Refusals inside the try still reach the finally below, which an exit
    # here would not guarantee.
    if ($_.Exception.Message -notlike 'REFUSED:*') { throw }
    Write-Host ('Refused: ' + $_.Exception.Message.Substring(8))
    $code = 3
} finally {
    Remove-Item -LiteralPath $run -Recurse -Force -ErrorAction SilentlyContinue
}
if ($Mode -eq 'uninstall' -and (Test-Path -LiteralPath $programDir) -and
    -not (Get-ChildItem -LiteralPath $programDir -Force)) {
    Remove-Item -LiteralPath $programDir -Force
}
exit $code
