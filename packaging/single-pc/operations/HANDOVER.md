# Grocery POS: owner handover guide

For the store owner, at the end of the vendor's installation or maintenance
period. Keep a printed copy with the PC; it is also on the PC as
`help\HANDOVER.md` in the installed release folder
(`C:\Program Files\Valorthon\GroceryPOS\releases\<version>\`).

## Your credentials belong to the owner

- Your administrator username and password, and every manager PIN, belong
  to the owner. The vendor does not keep them and cannot recover them.
- You received a temporary password at installation and chose your own when
  you first logged in. Keep it somewhere safe that is not on this PC.
- If an administrator forgets their password, another administrator resets
  it from **Users**; the person then chooses a new one at their next login.
  If the only administrator forgets, call the vendor (a restore of a backup
  brings back the passwords that were in it).

## Shortcuts on the desktop and in the Start menu

| Shortcut                 | What it does                                                         |
| ------------------------ | -------------------------------------------------------------------- |
| **Grocery POS**          | Waits until the system is ready, then opens it in Chrome.            |
| **Back up to USB drive** | Makes a fresh backup and copies it to a USB drive or SD card.        |
| **Check Grocery POS**    | Checks the system and tells you what to do if something is wrong.    |
| **Grocery POS help**     | Opens the "what to do when something goes wrong" guide (Start menu). |

Always open the app with the **Grocery POS** shortcut. The address is
`https://localhost:1443`. Never click through a certificate warning; run
**Check Grocery POS** instead.

## Every day

- Switch the PC on; the system starts by itself. Use the shortcut.
- Cashiers open and close their own shifts.
- Shut down from the Windows Start menu, never with the power button.
- Do not clear Chrome's browsing data: it holds parked tickets and offline
  cash sales that have not been sent yet.

## Backups

- A backup is made automatically every night at 22:00 if the PC is on (or
  at the next start) and kept for 30 days.
- Every Monday a reminder asks you to copy a backup to a USB drive. Double
  click **Back up to USB drive**, answer Yes to the administrator prompt
  (an administrator password of this PC may be needed), pick the drive and
  wait for the success message.
- The USB copy contains all store data and can be read without a password:
  keep it locked away, ideally away from the store, and use more than one
  drive in turn.
- Restoring a backup replaces all data. It is done only by the vendor (or
  someone they instruct) with the protected restore tool.

## When something looks wrong

1. Double-click **Check Grocery POS** and answer Yes.
2. Follow what it says; **Grocery POS help** has the long version.
3. If the vendor asks for it, use **Save support file…** in the check and
   send the file. It contains no sales data, passwords or names.

## Change password

Any user: click your name (top right, or the bottom of the side menu) >
**Change password**, enter the current password and the new one (at least 8
characters). You are logged out and log in again with the new password.

## Manager PINs

Discounts and voids/refunds need a manager's six-digit PIN. An
administrator sets or resets PINs in **Users** (it asks for your own
password first). Keep PINs private.

## After the maintenance period

The vendor no longer updates the system after the agreed period. Keep
making USB backups and keep this guide and the vendor's contact details
with the PC.
