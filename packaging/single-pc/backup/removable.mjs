// Export destinations must be removable media (owner decision on #363):
// a USB/SD/MMC/FireWire disk that is not the disk holding the installation.
// Windows asks the Storage module about the volume that holds the folder
// (Get-Volume -FilePath follows drive letters, folder mount points and
// subst drives to the real volume); Linux reads sysfs. Anything that cannot
// be identified is refused, never assumed removable.
import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const REMOVABLE_BUSES = Object.freeze(['USB', 'SD', 'MMC', '1394']);

/** Pure: Windows facts → verdict. */
export function classifyWindows(dest, root) {
    if (!dest || !Number.isSafeInteger(dest.diskNumber))
        return { removable: false, reason: 'unknown' };
    if (root && dest.diskNumber === root.diskNumber)
        return { removable: false, reason: 'same-disk' };
    if (dest.isBoot || dest.isSystem)
        return { removable: false, reason: 'system-disk' };
    if (
        dest.driveType === 'Removable' ||
        REMOVABLE_BUSES.includes(dest.busType)
    )
        return { removable: true, reason: 'removable' };
    return { removable: false, reason: 'fixed' };
}

/** Pure: Linux facts → verdict. */
export function classifyLinux(dest, root) {
    if (!dest?.disk) return { removable: false, reason: 'unknown' };
    if (root?.disk && dest.disk === root.disk)
        return { removable: false, reason: 'same-disk' };
    if (dest.removableFlag || dest.usb)
        return { removable: true, reason: 'removable' };
    return { removable: false, reason: 'fixed' };
}

const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'Stop'
function Facts($path) {
  $v = Get-Volume -FilePath $path
  $d = $v | Get-Partition | Get-Disk
  [pscustomobject]@{ driveType = [string]$v.DriveType; busType = [string]$d.BusType; diskNumber = [int]$d.Number; isBoot = [bool]$d.IsBoot; isSystem = [bool]$d.IsSystem }
}
[pscustomobject]@{ dest = (Facts $env:GPOS_DEST); root = (Facts $env:GPOS_ROOT) } | ConvertTo-Json -Compress
`;

function windowsFacts(dest, root) {
    return new Promise((done) => {
        execFile(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT],
            {
                env: { ...process.env, GPOS_DEST: dest, GPOS_ROOT: root },
                windowsHide: true,
                timeout: 30000,
            },
            (error, stdout) => {
                if (error) return done(undefined);
                try {
                    done(JSON.parse(stdout));
                } catch {
                    done(undefined);
                }
            },
        );
    });
}

/** Linux block device of a path: whole disk name, removable flag, USB bus. */
export async function linuxFacts(path) {
    const dev = BigInt((await stat(path, { bigint: true })).dev);
    const major = Number(((dev >> 8n) & 0xfffn) | ((dev >> 32n) & ~0xfffn));
    const minor = Number((dev & 0xffn) | ((dev >> 12n) & ~0xffn));
    let sys;
    try {
        sys = await realpath(`/sys/dev/block/${major}:${minor}`);
    } catch {
        return undefined; // tmpfs, overlay, network: not a block device
    }
    const isPartition = await stat(join(sys, 'partition')).then(
        () => true,
        () => false,
    );
    const disk = isPartition ? dirname(sys) : sys;
    const flag = await readFile(join(disk, 'removable'), 'utf8').catch(
        () => '0',
    );
    return {
        disk,
        removableFlag: flag.trim() === '1',
        usb: /\/usb\d*\//.test(disk),
    };
}

/** The verdict for an export destination relative to the data root. */
export async function destinationMedia(dest, root) {
    if (process.platform === 'win32') {
        const facts = await windowsFacts(dest, root);
        return classifyWindows(facts?.dest, facts?.root);
    }
    if (process.platform === 'linux') {
        return classifyLinux(
            await linuxFacts(dest).catch(() => undefined),
            await linuxFacts(root).catch(() => undefined),
        );
    }
    return { removable: false, reason: 'unknown' };
}
