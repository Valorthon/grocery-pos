#Requires -Version 5.1
<#
.SYNOPSIS
    Weekly export reminder (#362, owner decision #363: weekly reminders to
    export a backup to an external drive). Scheduled for whoever is logged
    on, without elevation; it only shows a message. Backups themselves run
    daily as SYSTEM (backup.mjs create --kind scheduled).
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

[void][System.Windows.Forms.MessageBox]::Show(
    ("Weekly reminder: copy a backup to your external USB drive.`n`n" +
        'Grocery POS makes a verified backup on this computer every day. ' +
        'A copy on an external drive protects your records if this ' +
        'computer is lost or damaged. Keep the drive somewhere safe.'),
    'Grocery POS backup reminder',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information)
exit 0
