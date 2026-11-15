# Replacement-PC reinstall and restore (single-PC edition)

When the store PC is lost, broken or replaced, the vendor restores the
newest exported backup onto a compatible PC and installs Grocery POS over
it. There is no promised recovery time (owner decision #357); this is the
procedure. Tool details: [../backup/README.md](../backup/README.md)
"Restore" and "Replacement PC".

**Status:** the restore onto an empty data root is tested on Linux
end-to-end (an ADMIN login through the compiled API afterwards); the
Windows order below is not yet performed (RUNBOOK B7).

## What you need

- A PC that meets [INSTALL.md](INSTALL.md) "Before the visit", with **no**
  earlier Grocery POS installation (`C:\ProgramData\Valorthon\GroceryPOS`
  absent or empty).
- The owner's USB drive with a `GroceryPOS-backup-<id>` folder (the newest
  export). An export carries the store's data **and its secrets**, without a
  password: keep it as safe as the PC itself.
- The verified bundle of the **same or a newer** release than the one that
  made the backup (an older release refuses newer data).

## What is lost

- Sales and changes made after that backup.
- Chrome data on the old PC: parked tickets and queued offline cash sales.
  Count the drawer for any cash sale that never reached the server and
  record it by hand.

## Steps

Why this order: a restore onto an existing installation requires the same
installation id and secrets, so a freshly installed PC would refuse the old
store's backup. Restoring onto the empty data root first places the
backup's identity and secrets; the installer then treats the data root as
its own (a reinstall) and keeps the restored users.

1. Copy the bundle folder and the export folder to the PC (for example
   `C:\GroceryPOS-Setup` and `C:\GroceryPOS-Restore\GroceryPOS-backup-<id>`).
   In an elevated Windows PowerShell compare
   `(Get-FileHash C:\GroceryPOS-Setup\bundle-manifest.json).Hash` with the
   recorded hash, and run nothing from the bundle until it matches.
2. Verify the export, then restore it onto the empty data root with the
   bundle's own release tools (from `C:\GroceryPOS-Setup\release`):

    ```text
    node\node.exe tools\backup\backup.mjs verify --data-root "C:\ProgramData\Valorthon\GroceryPOS" --mongod mongodb\bin\mongod.exe --tools mongodb\bin --api api --from C:\GroceryPOS-Restore\GroceryPOS-backup-<id>
    node\node.exe tools\backup\restore.mjs --data-root "C:\ProgramData\Valorthon\GroceryPOS" --from C:\GroceryPOS-Restore\GroceryPOS-backup-<id> --confirm <id> --mongod mongodb\bin\mongod.exe --tools mongodb\bin --api api
    ```

    `--confirm` must repeat the backup id exactly. The tool places the
    backup's identity and secrets, provisions the database, restores, and
    takes older data forward to this release. If it stops part-way, re-run
    the same command (RECOVERY.md "A restore stopped part-way").

3. Install over the restored data root as in [INSTALL.md](INSTALL.md)
   ("At the store", step 3, with the store's existing administrator
   username). The installer reports the first administrator as already
   present; no handover password is created.
4. Open **Grocery POS**; everyone logs in again with their existing
   passwords (all sessions ended). An ADMIN reconciles any offline cash
   sale that a register still holds (#37).
5. Run **Check Grocery POS**, then make a backup and a new USB export.
6. Record the restore duration for the owner.

To restore an older backup onto the **same** PC (data damaged), use the
same `restore.mjs` command with the services `GroceryPOS-Proxy` and
`GroceryPOS-API` stopped; it refuses open shifts, active offline leases and
newer sales unless the matching `--accept-*` flag is given, and takes a
safety backup first.
