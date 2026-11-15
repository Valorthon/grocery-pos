#Requires -Version 5.1
<#
.SYNOPSIS
    "Check Grocery POS" shortcut target (#365, owner decisions 2026-11-15).
    Runs diagnose.mjs check, shows the plain-language result with recovery
    steps, points to the "Grocery POS help" guide and lets the owner save a
    support file (diagnose.mjs export) to a folder they choose.
    It asks for elevation (the certificate and backup status are
    admin-only); if the owner declines, a partial check still runs and says
    which parts it could not see. Nothing is sent anywhere.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$DataRoot,
    [Parameter(Mandatory = $true)][string]$Release,
    [switch]$NoElevation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$title = 'Check Grocery POS'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $NoElevation -and -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-File', ('"' + $PSCommandPath + '"'),
        '-DataRoot', ('"' + $DataRoot + '"'),
        '-Release', ('"' + $Release + '"'))
    try {
        Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments
    } catch {
        # Declined: a partial check as the current user.
        Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList ($arguments + '-NoElevation')
    }
    exit 0
}

$node = Join-Path $Release 'node\node.exe'
$script = Join-Path $Release 'tools\diagnostics\diagnose.mjs'
$guide = Join-Path $Release 'help\RECOVERY.md'

function Invoke-Diagnose([string[]]$Arguments) {
    $out = [System.IO.Path]::GetTempFileName()
    $err = [System.IO.Path]::GetTempFileName()
    try {
        # Double a trailing backslash (E:\) so it cannot escape the quote.
        $quoted = $Arguments | ForEach-Object { '"' + ($_ -replace '(\\+)$', '$1$1') + '"' }
        $process = Start-Process -FilePath $node -ArgumentList $quoted -Wait -PassThru `
            -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
        return @{
            Code = $process.ExitCode
            Out = [string]::Join("`r`n", @(Get-Content -LiteralPath $out))
            Err = [string]::Join("`r`n", @(Get-Content -LiteralPath $err))
        }
    } finally {
        Remove-Item -LiteralPath $out, $err -Force -ErrorAction SilentlyContinue
    }
}

$check = Invoke-Diagnose @($script, 'check', '--data-root', $DataRoot, '--release', $Release)
$text = $check.Out
if (-not $text) { $text = 'The check could not run. Restart the PC and try again, or contact your vendor.' }
if ($NoElevation) {
    $text = "Partial check (administrator permission was not given).`r`n`r`n" + $text
}

$form = New-Object System.Windows.Forms.Form
$form.Text = $title
$form.StartPosition = 'CenterScreen'
$form.ClientSize = New-Object System.Drawing.Size(760, 540)
$box = New-Object System.Windows.Forms.TextBox
$box.Multiline = $true
$box.ReadOnly = $true
$box.ScrollBars = 'Vertical'
$box.Font = New-Object System.Drawing.Font('Consolas', 10)
$box.Text = $text
$box.SetBounds(12, 12, 736, 470)
$box.Anchor = 'Top, Bottom, Left, Right'
$help = New-Object System.Windows.Forms.Button
$help.Text = 'Open help'
$help.SetBounds(12, 494, 120, 34)
$help.Anchor = 'Bottom, Left'
$help.Add_Click({ Start-Process -FilePath 'notepad.exe' -ArgumentList ('"' + $guide + '"') })
$save = New-Object System.Windows.Forms.Button
$save.Text = 'Save support file...'
$save.SetBounds(142, 494, 170, 34)
$save.Anchor = 'Bottom, Left'
$save.Add_Click({
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    $picker.Description = 'Choose where to save the support file (for example your USB drive). It contains the check result and recent log lines with passwords, names and addresses removed; no sales or customer data.'
    if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return }
    $saved = Invoke-Diagnose @($script, 'export', '--data-root', $DataRoot, '--release', $Release, '--to', $picker.SelectedPath)
    if ($saved.Code -eq 0) {
        [void][System.Windows.Forms.MessageBox]::Show($saved.Out, $title)
    } else {
        $reason = 'The support file could not be saved.'
        if ($saved.Err -match '^Failed: ' -and $saved.Err -notmatch 'mongodb(\+srv)?://|password|secret') { $reason = $saved.Err }
        [void][System.Windows.Forms.MessageBox]::Show($reason, $title,
            [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
    }
})
$close = New-Object System.Windows.Forms.Button
$close.Text = 'Close'
$close.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$close.SetBounds(648, 494, 100, 34)
$close.Anchor = 'Bottom, Right'
$form.Controls.AddRange(@($box, $help, $save, $close))
$form.CancelButton = $close
[void]$form.ShowDialog()
exit 0
