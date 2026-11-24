Grocery POS single-PC installation bundle (Windows 10 or 11 x64, Google Chrome)

Before anything else, compare (Get-FileHash .\bundle-manifest.json).Hash with
the bundle-manifest.json SHA-256 the vendor recorded when building (kept
apart from this folder). If they differ, do not install.

Vendor use only. Nothing is downloaded at the store.

1. Copy this whole folder to the store PC (for example C:\GroceryPOS-Setup).
2. Open Windows PowerShell as an administrator in that folder.
3. Install:   powershell -ExecutionPolicy Bypass -File .\Install.ps1 -ManifestSha256 <recorded hash> -Mode install -AdminUsername <name>
   Repair:    powershell -ExecutionPolicy Bypass -File .\Install.ps1 -ManifestSha256 <recorded hash> -Mode repair
   Uninstall: powershell -ExecutionPolicy Bypass -File .\Install.ps1 -ManifestSha256 <recorded hash> -Mode uninstall
4. Hand over the folder C:\ProgramData\Valorthon\GroceryPOS-Handover in person
   (first administrator's temporary password). After the owner has logged in
   and changed it: .\Install.ps1 -ManifestSha256 <recorded hash> -Mode handover-done

Uninstall keeps the data (C:\ProgramData\Valorthon\GroceryPOS), backups,
secrets, the local certificate and every Chrome profile. See
packaging/single-pc/operations/INSTALL.md in the source for the full
procedure (installer/README.md for details), release\help\HANDOVER.md for the
owner's guide, and release\notices\ for licenses and source locations.
