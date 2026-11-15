// Admin-only folders for restores and export verification (#366).
//
// A fresh restore copies the store's secrets into a data root that may not
// exist yet, and an export check runs a scratch copy of the whole store
// beside it. Both folders, and the parent they are created in, must be
// controlled by SYSTEM/Administrators only, and must not be reparse points
// (junctions, symlinks) that redirect the writes elsewhere. Windows facts
// come from an injectable `exec` so the decisions are tested on Linux.
import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdir, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { RefusedError } from '../runtime/provision.mjs';

/** Well-known SIDs: SYSTEM and BUILTIN\Administrators. */
export const ADMIN_SIDS = Object.freeze(['S-1-5-18', 'S-1-5-32-544']);

/** Owner Administrators, inheritance removed, SYSTEM + Administrators only. */
export function secureFolderSteps(path) {
    return [
        ['icacls', [path, '/setowner', '*S-1-5-32-544']],
        [
            'icacls',
            [
                path,
                '/inheritance:r',
                '/grant:r',
                '*S-1-5-18:(OI)(CI)F',
                '*S-1-5-32-544:(OI)(CI)F',
            ],
        ],
    ];
}

/** PowerShell that prints a folder's owner SID and every ACE's SID. */
export function aclQuery(path) {
    const literal = path.replace(/'/g, "''");
    return [
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `$a = Get-Acl -LiteralPath '${literal}'; $s = [System.Security.Principal.SecurityIdentifier]; ` +
                `[pscustomobject]@{ Owner = $a.GetOwner($s).Value; Sids = @($a.GetAccessRules($true, $true, $s) | ForEach-Object { $_.IdentityReference.Value }) } | ConvertTo-Json -Compress`,
        ],
    ];
}

/** Problems with a folder's ACL facts (`{Owner, Sids}`), else []. */
export function aclProblems(facts, { checkAces = true } = {}) {
    const problems = [];
    if (!ADMIN_SIDS.includes(facts?.Owner))
        problems.push(`owned by ${facts?.Owner ?? 'unknown'}`);
    if (checkAces)
        for (const sid of [].concat(facts?.Sids ?? []))
            if (!ADMIN_SIDS.includes(sid)) problems.push(`grants ${sid}`);
    return problems;
}

export const realExec = (file, args) =>
    execFileSync(file, args, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
    });

function context(ctx = {}) {
    return {
        platform: ctx.platform ?? process.platform,
        exec: ctx.exec ?? realExec,
        lstat: ctx.lstat ?? lstat,
    };
}

async function existing(c, path) {
    try {
        return await c.lstat(path);
    } catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw error;
    }
}

function facts(c, path) {
    return JSON.parse(c.exec(...aclQuery(path)));
}

/** Refuses a junction/symlink (Node reports Windows junctions as links). */
export async function assertPlainFolder(path, ctx) {
    const c = context(ctx);
    const info = await c.lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory())
        throw new RefusedError(
            `${path} is a link or junction, not a plain folder. Restart the PC, delete it as an administrator, and try again.`,
        );
}

/**
 * The parent the folder is created in (for example C:\ProgramData\Valorthon):
 * created here and secured, or it must already be a plain folder owned by
 * SYSTEM/Administrators. A standard user could otherwise replace the
 * folder below it between our checks.
 */
export async function secureParent(parent, ctx) {
    const c = context(ctx);
    const found = await existing(c, parent);
    if (!found) {
        await mkdir(parent, { recursive: true, mode: 0o755 });
        if (c.platform === 'win32')
            for (const step of secureFolderSteps(parent)) c.exec(...step);
    }
    await assertPlainFolder(parent, c);
    if (c.platform === 'win32') {
        const problems = aclProblems(facts(c, parent), { checkAces: false });
        if (problems.length)
            throw new RefusedError(
                `${parent} is ${problems.join(', ')}, not by Administrators. Ask your vendor; nothing was changed.`,
            );
    }
}

/**
 * Creates `path` (non-recursively, after securing its parent) or takes an
 * existing admin-owned plain folder, then makes it admin-only and checks
 * that nothing but SYSTEM/Administrators remains. `mustBeNew` refuses any
 * existing folder.
 */
export async function secureFolder(path, ctx, { mustBeNew = false } = {}) {
    const c = context(ctx);
    await secureParent(dirname(path), c);
    const found = await existing(c, path);
    if (found) {
        if (mustBeNew) throw new RefusedError(`${path} already exists.`);
        await assertPlainFolder(path, c);
        if (c.platform === 'win32') {
            const problems = aclProblems(facts(c, path), { checkAces: false });
            if (problems.length)
                throw new RefusedError(
                    `${path} already exists and is ${problems.join(', ')}. Delete it and try again.`,
                );
        }
    } else {
        await mkdir(path, { mode: 0o700 });
    }
    if (c.platform === 'win32') {
        for (const step of secureFolderSteps(path)) c.exec(...step);
    } else {
        await chmod(path, 0o700);
    }
}

/** After securing: a plain folder and, on Windows, admin-only ACEs. */
export async function assertAdminOnly(path, ctx) {
    const c = context(ctx);
    await assertPlainFolder(path, c);
    if (c.platform !== 'win32') return;
    const problems = aclProblems(facts(c, path));
    if (problems.length)
        throw new RefusedError(
            `${path} is not admin-only (${problems.join(', ')}); no secret was copied.`,
        );
}

/** The folder holds exactly `names` (what this run created), nothing else. */
export async function assertOnly(path, names) {
    const extra = (await readdir(path)).filter((n) => !names.includes(n));
    if (extra.length)
        throw new RefusedError(
            `${path} gained unexpected entries (${extra.join(', ')}); no secret was copied.`,
        );
}
