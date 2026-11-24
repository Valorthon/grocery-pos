# Vendor installation guide (single-PC edition)

For the vendor who installs Grocery POS on a store PC (owner decision #357:
the vendor installs, the store owner keeps the credentials). The details of
each step are in [../installer/README.md](../installer/README.md); this guide
is the order to do them in.

**Status:** not yet performed on Windows 10 or 11. The first run is RUNBOOK B1
([../acceptance/RUNBOOK.md](../acceptance/RUNBOOK.md)); fix this guide where
it differs from what you see (B15).

## Before the visit

1. The PC: Windows 10 (build 10240–19045, ideally 22H2) or Windows 11
   (build 22000 or later), client edition (Home or Pro), Intel/AMD x64 with
   AVX, Google Chrome installed, at least 5 GB free on the data drive, ideally a
   UPS. 4 GB RAM is the target being qualified, not a proven minimum.
2. Build the bundle from the release commit on the vendor build machine:

    ```bash
    pnpm install --frozen-lockfile
    node packaging/single-pc/installer/bundle.mjs --out <new folder>
    node packaging/single-pc/acceptance/readiness.mjs --bundle <new folder> --manifest-sha256 <printed hash> --caddy <caddy 2.11.9 for this machine>
    ```

    `--caddy` adapts the shipped Caddyfile and Caddyfile.lan with a client
    folder containing a space, as under `C:\Program Files`. On Windows the
    bundle's own `caddy.exe` is used without it.

3. Write the printed `bundle-manifest.json SHA-256` in your build log and on
   a note kept **apart from** the USB stick. It is the only proof the bundle
   was not changed on the way.
4. Copy the whole bundle folder to a USB stick. Agree the first
   administrator's username with the owner (lower case; no password yet).

## Install-day checklist (Windows settings)

Most stores run Windows 10 Home. Before installing:

1. **Check the PC.** Settings > System > About shows the edition, version and
   build. Or, in PowerShell:
   `Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber, OSArchitecture`
   (or `wmic os get Caption,Version,BuildNumber,OSArchitecture`). The
   architecture must read 64-bit. The CPU must support AVX (MongoDB needs it): look up the CPU model,
   or run the installer, which refuses a CPU known to lack AVX and warns when
   it can't tell.
2. **Update Windows 10 to 22H2** (build 19045) through Windows Update. If Windows
   Update doesn't offer it, use Microsoft's Windows 10 Update Assistant or
   Media Creation Tool ("Upgrade this PC now"); allow 1–2 hours and about
   20 GB free. Older versions install with a warning only. If `Install.ps1`
   prints "This Windows 10 is too old to run the installer. Update Windows 10
   to version 22H2, then run the installer again.", do that first.
3. **Activation.** Settings > Update & Security > Activation should say
   Windows is activated.
4. **Extended Security Updates (advice).** Windows 10 no longer gets free
   security updates. Enrol the PC in Microsoft's consumer ESU programme if the owner
   agrees (Settings > Windows Update shows the offer). It is free when
   signed in with a Microsoft account with Windows Backup settings sync on,
   otherwise paid (about US$30 a year); check Microsoft's current terms. The installer does not
   check this.
5. **Active hours.** Windows 10 Home restarts on its own for updates. Set
   Settings > Windows Update > Change active hours to cover store hours.
6. **Windows 11 upgrade prompts.** Decline them during a working day; upgrade
   only on a closed day, with a verified backup, then check the app.

## At the store (offline is fine; nothing is downloaded)

1. Copy the bundle folder to the PC, for example `C:\GroceryPOS-Setup`.
2. Open **Windows PowerShell as administrator** in that folder and compare:
   `(Get-FileHash .\bundle-manifest.json).Hash` must equal your note. If it
   differs, stop.
3. Install (store timezone and backup time optional; defaults Asia/Manila and
   22:00):

    ```powershell
    powershell -ExecutionPolicy Bypass -File .\Install.ps1 -ManifestSha256 <hash> -Mode install -AdminUsername <name> [-StoreTimezone Asia/Manila] [-BackupTime 22:00]
    ```

    Exit 0 is done; 3 means it refused and changed nothing (the message says
    why: wrong Windows, port in use, low disk, already installed → use
    `-Mode repair`); 1 means it failed part-way: run the command the last
    line prints ("To resume, run: …"). That is `-Mode repair` once the
    install has registered its services (`-Mode install` would then be
    refused as already installed), else the same `-Mode install` again;
    both resume. Every run ends with `Installer log:` and the path of
    `state\installer-<UTC time>.log` in the data folder; keep it with the
    deployment evidence. A service that misses its readiness timeout
    shows the last lines of its own error log.

4. Check: double-click **Check Grocery POS** on the desktop and answer Yes;
   every line should be OK (Backups may say no backup yet).
5. Double-click **Grocery POS**. Chrome opens `https://localhost:1443` with
   no certificate warning. Never click through a warning; run repair instead.

## Handing over the first administrator

1. The temporary password is in
   `C:\ProgramData\Valorthon\GroceryPOS-Handover\initial-admin-password.txt`
   (readable by administrators only). Do not photograph, copy or email it.
2. With the owner present, let the **owner** open the file, log in with the
   username and that password, and choose a new password when asked. You do
   not learn the new password.
3. Then delete the handover folder:

    ```powershell
    powershell -ExecutionPolicy Bypass -File .\Install.ps1 -ManifestSha256 <hash> -Mode handover-done
    ```

4. Walk the owner through [HANDOVER.md](HANDOVER.md) (it is also on the PC
   in the Start menu as **Grocery POS owner guide**).
5. Make the first backup and USB export together ("Back up to USB drive").
   Tell the owner the drive holds the store's keys (database passwords,
   sign-in secret, the local HTTPS root key): keep it locked away like a key,
   never share it, and tell the vendor at once if it is lost.
6. Keep the bundle folder (or the USB stick) for repairs, and delete the copy
   in `C:\GroceryPOS-Setup` if the owner prefers; the installation does not
   need it.

## Repair, uninstall, reinstall

- Repair (keeps data, admin and secrets): `-Mode repair`.
- Uninstall (keeps the data folder, backups, secrets and certificate):
  `-Mode uninstall [-RemoveCaTrust]`.
- Reinstall over kept data: `-Mode install` again; the existing
  administrator and data are used.

Upgrades are in [MAINTENANCE.md](MAINTENANCE.md); a new PC in
[REPLACEMENT-PC.md](REPLACEMENT-PC.md).
