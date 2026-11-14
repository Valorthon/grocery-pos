Grocery POS single-PC installation bundle (Windows 11 x64, Google Chrome)

Vendor use only. Nothing is downloaded at the store.

1. Copy this whole folder to the store PC (for example C:\GroceryPOS-Setup).
2. Open Windows PowerShell as an administrator in that folder.
3. Install:   powershell -ExecutionPolicy Bypass -File .\Install.ps1 -Mode install -AdminUsername <name>
   Repair:    powershell -ExecutionPolicy Bypass -File .\Install.ps1 -Mode repair
   Uninstall: powershell -ExecutionPolicy Bypass -File .\Install.ps1 -Mode uninstall
4. Hand over the folder C:\ProgramData\Valorthon\GroceryPOS-Handover in person
   (first administrator's temporary password). After the owner has logged in
   and changed it: .\Install.ps1 -Mode handover-done

Uninstall keeps the data (C:\ProgramData\Valorthon\GroceryPOS), backups,
secrets, the local certificate and every Chrome profile. See
packaging/single-pc/installer/README.md in the source for details, and
release\notices\ for licenses and source locations.
