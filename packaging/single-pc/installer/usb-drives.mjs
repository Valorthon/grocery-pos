// Drives offered by "Back up to USB drive" (#362): every lettered volume
// that the #363 export would accept, decided by the same rule
// (../backup/removable.mjs `destinationMedia`: USB/SD/MMC/1394 bus or a
// removable drive type, never the boot/system disk or the disk holding the
// installation). USB hard disks and SSDs are therefore offered too.
//
//   node usb-drives.mjs --data-root <abs>   → JSON array such as ["E:\\"]
import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { destinationMedia } from '../backup/removable.mjs';

/** Letters (`E:\`) the export would accept, in order. */
export async function acceptableDrives(
    letters,
    dataRoot,
    media = destinationMedia,
) {
    const out = [];
    for (const letter of letters) {
        const verdict = await media(letter, dataRoot).catch(() => undefined);
        if (verdict?.removable === true) out.push(letter);
    }
    return out;
}

/** `E:\` from PowerShell's Get-Volume lines; anything else is dropped. */
export function parseLetters(stdout) {
    return [
        ...new Set(
            String(stdout)
                .split(/\r?\n/)
                .map((line) => line.trim().toUpperCase())
                .filter((line) => /^[A-Z]$/.test(line))
                .map((letter) => `${letter}:\\`),
        ),
    ].sort();
}

function windowsLetters() {
    return new Promise((done) => {
        execFile(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                'Get-Volume | Where-Object { $_.DriveLetter } | ForEach-Object { $_.DriveLetter }',
            ],
            { windowsHide: true, timeout: 30000 },
            (error, stdout) => done(error ? [] : parseLetters(stdout)),
        );
    });
}

async function main() {
    const args = process.argv.slice(2);
    if (
        args.length !== 2 ||
        args[0] !== '--data-root' ||
        !isAbsolute(args[1])
    ) {
        process.stderr.write('Usage: usb-drives.mjs --data-root <abs>\n');
        return 2;
    }
    if (process.platform !== 'win32') {
        process.stdout.write('[]\n');
        return 0;
    }
    const drives = await acceptableDrives(await windowsLetters(), args[1]);
    process.stdout.write(`${JSON.stringify(drives)}\n`);
    return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    process.exit(await main());
}
