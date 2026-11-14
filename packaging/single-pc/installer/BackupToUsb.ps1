#Requires -Version 5.1
<#
.SYNOPSIS
    "Back up to USB drive" shortcut target (#362, owner decision 2026-11-15).
    Takes a fresh verified backup (backup.mjs create --kind manual), then
    exports it to the removable drive the owner picks (backup.mjs export).
    It needs administrator rights (backups read secrets\), so it asks for
    elevation through the normal Windows prompt. backup.mjs decides whether
    the drive is acceptable (removable only) and prints no secrets.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$DataRoot,
    [Parameter(Mandatory = $true)][string]$Release
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$title = 'Grocery POS: Back up to USB drive'

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
        Show-Message ('The backup needs administrator permission. It was not started.') 'Warning'
    }
    exit 0
}

# The drives the export accepts, by its own rule (usb-drives.mjs reuses
# removable.mjs: USB/SD/MMC/1394 bus, never the system or installation
# disk), so USB hard disks and SSDs are listed too.
$node = Join-Path $Release 'node\node.exe'
$listing = & $node (Join-Path $Release 'tools\installer\usb-drives.mjs') '--data-root' $DataRoot
$drives = @()
if ($LASTEXITCODE -eq 0 -and $listing) {
    $drives = @(([string]::Join('', @($listing)) | ConvertFrom-Json))
}
if ($drives.Count -eq 0) {
    Show-Message ("No USB drive was found.`n`nPlug in your backup USB drive, " +
        'wait until Windows shows it, then open "Back up to USB drive" again.') 'Warning'
    exit 1
}

$form = New-Object System.Windows.Forms.Form
$form.Text = $title
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ClientSize = New-Object System.Drawing.Size(420, 150)
$label = New-Object System.Windows.Forms.Label
$label.Text = "Back up to this drive. It takes a few minutes; a message appears when it is done."
$label.SetBounds(12, 12, 396, 40)
$combo = New-Object System.Windows.Forms.ComboBox
$combo.DropDownStyle = 'DropDownList'
$combo.SetBounds(12, 58, 396, 28)
foreach ($drive in $drives) { [void]$combo.Items.Add($drive) }
$combo.SelectedIndex = 0
$ok = New-Object System.Windows.Forms.Button
$ok.Text = 'Back up'
$ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
$ok.SetBounds(220, 104, 90, 32)
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = 'Cancel'
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$cancel.SetBounds(318, 104, 90, 32)
$form.Controls.AddRange(@($label, $combo, $ok, $cancel))
$form.AcceptButton = $ok
$form.CancelButton = $cancel
if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }
$target = [string]$combo.SelectedItem

$script = Join-Path $Release 'tools\backup\backup.mjs'
$bin = Join-Path $Release 'mongodb\bin'

function Invoke-Backup([string[]]$Arguments) {
    $out = [System.IO.Path]::GetTempFileName()
    $err = [System.IO.Path]::GetTempFileName()
    try {
        # Double a trailing backslash (E:\) so it cannot escape the quote.
        $quoted = $Arguments | ForEach-Object { '"' + ($_ -replace '(\\+)$', '$1$1') + '"' }
        $process = Start-Process -FilePath $node -ArgumentList $quoted -Wait -PassThru `
            -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
        # Only backup.mjs's own fixed result lines ("Refused: ..." or
        # "Failed [CODE]: ..."); anything else, or anything that looks like
        # a connection string or credential, becomes a generic line.
        $lines = @(Get-Content -LiteralPath $err | Where-Object { $_ -match '^(Refused: |Failed )' })
        $reason = 'The backup tool reported an error.'
        if ($lines.Count -and $lines[-1] -notmatch 'mongodb(\+srv)?://|password|secret') {
            $reason = $lines[-1]
        }
        return @{ Code = $process.ExitCode; Reason = $reason }
    } finally {
        Remove-Item -LiteralPath $out, $err -Force -ErrorAction SilentlyContinue
    }
}

$created = Invoke-Backup @($script, 'create', '--data-root', $DataRoot, '--mongod',
    (Join-Path $bin 'mongod.exe'), '--tools', $bin, '--api', (Join-Path $Release 'api'),
    '--kind', 'manual')
if ($created.Code -ne 0) {
    Show-Message ("The backup did not finish, so nothing was copied to $target.`n`n" +
        "$($created.Reason)`n`nTry again later. If it keeps failing, contact your vendor.") 'Error'
    exit 1
}

$exported = Invoke-Backup @($script, 'export', '--data-root', $DataRoot, '--to', $target)
if ($exported.Code -ne 0) {
    Show-Message ("A backup was made on this computer, but it could not be copied to $target.`n`n" +
        "$($exported.Reason)`n`nCheck that the drive is plugged in and has free space, then try again.") 'Error'
    exit 1
}

Show-Message ("Done. The backup was checked and copied to $target.`n`n" +
    'Remove the drive safely and keep it somewhere away from this computer.')
exit 0
