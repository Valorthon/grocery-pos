// Single-PC operator diagnostics (#365): a local, read-only health report
// with plain recovery steps. No network beyond this PC (loopback and, with
// LAN terminals, a TLS handshake to its own LAN address), no upload, no
// telemetry, never reads secrets\ and grants no application role.
//
//   node diagnose.mjs check --data-root <abs> [--release <abs>] [--json]
//   node diagnose.mjs export --data-root <abs> --to <folder> [--release <abs>]
//   node diagnose.mjs rotate-logs --data-root <abs> --api <release\api> [--keep N]
//
// `export` writes one support file (the check report plus recent redacted
// log lines) into a folder the owner picks; see README.md "Support export".
//
// `check` exits 0 when everything is OK, 1 when something needs attention
// (warn, fail or another unknown), 2 on a usage error, 3 when the only
// non-OK checks are unverified for lack of administrator rights.
// `rotate-logs` is a maintenance command (reads the MongoDB root password;
// run it elevated or as SYSTEM).
// See README.md and RECOVERY.md.
import { execFile } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import {
    mkdir,
    open,
    readFile,
    readdir,
    rm,
    stat,
    statfs,
    writeFile,
} from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readStatus, statusSummary } from '../backup/backup.mjs';
import {
    caddyRootCertificate,
    FIREWALL_RULE,
    MIN_FREE,
} from '../installer/plan.mjs';
import {
    DB_USERS,
    HEALTH,
    LOOPBACK,
    ORIGIN,
    PORTS,
    REPLICA_SET,
    LAN_SERVICE,
    SERVICES,
    isPrivateIpv4,
    layout,
} from '../runtime/layout.mjs';
import { AVX_PROBE_COMMAND, parseAvxProbe } from '../proof/policy.mjs';

export const EXIT = { OK: 0, ATTENTION: 1, USAGE: 2, UNVERIFIED: 3 };
export const STATUS_RANK = { ok: 0, info: 0, unknown: 1, warn: 2, fail: 3 };
/** Bytes of each log read from its end; error lines kept per source. */
export const LOG_TAIL_BYTES = 256 * 1024;
export const ERRORS_PER_SOURCE = 5;
/** mongod.log above this asks for `rotate-logs`. */
export const MONGOD_LOG_WARN_BYTES = 100 * 1024 ** 2;
export const ROTATED_LOGS_KEPT = 5;
/** Lines kept per log file in a support export. */
export const EXPORT_LINES_PER_FILE = 200;
export const REPORT_SCHEMA = 1;
/** The JSON report's top-level keys and status values (#364/#366 rely on them). */
export const REPORT_KEYS = Object.freeze([
    'schema',
    'generatedAt',
    'overall',
    'guide',
    'checks',
    'notObserved',
]);
export const STATUSES = Object.freeze([
    'ok',
    'info',
    'unknown',
    'warn',
    'fail',
]);
export const CHECK_IDS = Object.freeze([
    'versions',
    'services',
    'ports',
    'database',
    'api',
    'proxy',
    'lanProxy',
    'lanNetwork',
    'timeServer',
    'clockSync',
    'disk',
    'backups',
    'clock',
    'logs',
]);
/** The recovery guide inside a release (bundle.mjs ships it). */
export function guidePath(release) {
    return join(release, 'help', 'RECOVERY.md');
}
const DAY_MS = 24 * 3600 * 1000;

// ------------------------------------------------------------ redaction

const REDACTIONS = [
    // Cookie headers: every value to the end of the line, not only the first.
    [/\b((?:set-)?cookie\b["']?\s*[=:]\s*).*/gi, '$1[redacted]'],
    // Connection strings with credentials.
    [/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi, '$1[redacted]@'],
    // key=value / key: value / "key":"value" for secret-ish keys.
    [
        /(["']?\b(?:password|passwd|pwd|secret|token|authorization|pin|api[-_]?key|jwt[-_]?secret|cookie[-_]?secret|database[-_]?url|refresh[-_]?token)\b["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi,
        '$1[redacted]',
    ],
    [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [redacted]'],
    // JWTs.
    [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[redacted-jwt]'],
    // Long base64/base64url runs (generated secrets are 64+ characters).
    // Request ids (UUIDs, 36 characters) stay readable.
    [/[A-Za-z0-9+_-]{40,}={0,2}/g, '[redacted]'],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
    // User names: name-like keys (a duplicate-key message quotes the name)
    // and every quoted string (user text in error messages).
    [
        /(\b(?:user(?:name)?|name|cashier|actor|approvedBy|by|ctx)\b["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;})]+)/gi,
        '$1[user]',
    ],
    [/"[^"\n]*[A-Za-z][^"\n]*"/g, '"[text]"'],
    // IP addresses (IPv4, IPv6 incl. ::1 and mapped forms).
    [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]'],
    [/(?<![\w:])(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}(?![\w:])/gi, '[ip]'],
    [
        /(?<![\w:])(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?(?::?\[ip\])?(?![\w:])/gi,
        '[ip]',
    ],
    // Windows profile folder names are personal.
    [/(\\Users\\)[^\\\s"']+/gi, '$1<user>'],
    [/(\/home\/)[^/\s"']+/g, '$1<user>'],
];

/** Removes credentials, tokens, secrets and personal names from a line. */
export function redact(text) {
    let out = String(text);
    for (const [pattern, replacement] of REDACTIONS)
        out = out.replace(pattern, replacement);
    return out.length > 400 ? `${out.slice(0, 400)}…` : out;
}

// ------------------------------------------------------------ guidance

/** Plain recovery steps per finding; RECOVERY.md has the long form. */
export const GUIDANCE = Object.freeze({
    notInstalled: [
        'This PC has no complete Grocery POS installation record. Ask your vendor to run the installer (repair).',
    ],
    serviceStopped: [
        'Restart the PC; the services start on their own.',
        'If it stays stopped, open Services (services.msc), right-click the service and choose Start.',
        'Still stopped: see RECOVERY.md "The database or API does not start" and contact your vendor.',
    ],
    serviceMissing: [
        'A Grocery POS service is not installed. Ask your vendor to run the installer in repair mode.',
    ],
    // #489: added to a database that does not answer when AVX is absent or unknown.
    noAvx: [
        'The processor may not support AVX, which the database needs. If this PC is old, see RECOVERY.md "The database or API does not start" and contact your vendor.',
    ],
    portClosed: [
        'The service is not answering on its port. Wait 5 minutes after a restart (the database may be recovering), then run this check again.',
        'If it persists, restart the PC. See RECOVERY.md "The database or API does not start".',
    ],
    exposed: [
        'A Grocery POS port is reachable from the network. Unplug the network cable or turn off Wi-Fi and contact your vendor at once; do not keep selling until it is fixed.',
    ],
    databaseNotPrimary: [
        'The database is starting or recovering (for example after a power cut). Wait 5 minutes and run this check again.',
        'Do not delete anything in the database folder. If it does not recover, see RECOVERY.md "Interrupted shutdown or power loss".',
    ],
    apiNotReady: [
        'The application is running but cannot use the database. Check the database result above first.',
        'Restart the PC. If it persists, see RECOVERY.md "The database or API does not start".',
    ],
    apiUnhealthy: [
        'The application reports low memory or low disk space. Check the disk result below, then restart the PC.',
    ],
    proxy: [
        'The browser address https://localhost:1443 is not working. Restart the PC.',
        'If Chrome shows a certificate warning, see RECOVERY.md "Certificate or address problems"; never click through the warning.',
    ],
    lanProxy: [
        'LAN terminals cannot connect; this PC keeps working at https://localhost:1443.',
        'Check the network cable or Wi-Fi and that the router is on: this PC must have its fixed LAN address back. The LAN service retries by itself.',
        'Still down after the network is back: restart the PC. See RECOVERY.md "LAN terminals cannot connect".',
    ],
    lanAddressGone: [
        "This PC no longer has its fixed LAN address, so terminals cannot reach it. Check the cable or Wi-Fi, then check the router's address reservation (or the PC's static IP) still gives this PC the same address.",
        'If the address had to change, every terminal must be joined again. See RECOVERY.md "LAN address changed".',
    ],
    lanPublic: [
        "The network is set to Public, where the terminals' firewall rule does not apply. In Windows Settings > Network & internet, open this network and choose Private.",
    ],
    lanFirewall: [
        'The firewall rule for LAN terminals is missing or turned off. Ask your vendor to run the installer in repair mode.',
    ],
    lanCertificate: [
        'The LAN address\'s certificate does not match. Restart the PC; if it persists, ask your vendor to run the installer in repair mode. See RECOVERY.md "LAN terminals cannot connect".',
    ],
    timeServer: [
        "LAN terminals take their time from this PC, but its time service is off, so the terminals' clocks will drift and offline cash sales may be refused.",
        'Restart the PC. If this stays, ask your vendor to run the installer in repair mode. See RECOVERY.md "Terminal clocks".',
    ],
    lanProxyMissing: [
        'LAN terminals are configured but their service is not installed. Ask your vendor to run the installer in repair mode.',
    ],
    certificate: [
        'The local security certificate is missing or expiring. Ask your vendor to run the installer in repair mode (it renews the local certificate and trusts it again).',
    ],
    diskFull: [
        'The disk is almost full. Delete personal files you no longer need (Downloads, videos) or empty the Recycle Bin.',
        'Never delete files in the Grocery POS data folder. See RECOVERY.md "Disk full".',
    ],
    diskLow: [
        'Free space is getting low. Remove unneeded personal files soon. See RECOVERY.md "Disk full".',
    ],
    backupFailed: [
        'The last backup failed. Make sure the PC is on at 22:00 (or it runs at the next start), then run "Back up to USB drive" or wait for tonight\'s backup.',
        'See RECOVERY.md "Backup failed" for the reason code shown.',
    ],
    backupOverdue: [
        'No verified backup in the last 36 hours. Leave the PC on overnight, or ask your vendor to run a manual backup. See RECOVERY.md "Backup failed".',
    ],
    exportDue: [
        'Copy a backup to your USB drive: double-click "Back up to USB drive" on the desktop. See RECOVERY.md "USB drive not available".',
    ],
    backupStatusUnreadable: [
        'The backup status file is unreadable. Run a backup (the tool keeps the damaged file aside) or contact your vendor.',
    ],
    clockSync: [
        "Windows is not keeping this PC's clock in sync (Set time automatically is off or the time service is disabled), so it can drift (on a dual-boot PC by hours), which puts sales on the wrong day and may refuse offline cash sales.",
        'Turn on Set time automatically in Windows Settings > Time & language > Date & time, then press Sync now. See RECOVERY.md "Clock sync".',
    ],
    clock: [
        'The PC clock is behind the last recorded activity. Fix the date and time in Windows Settings > Time & language, then restart the PC.',
        'Wrong clocks put sales on the wrong day; do not sell until it is fixed.',
    ],
    logs: [
        'The database log is large. Ask your vendor to run `diagnose.mjs rotate-logs`, or see RECOVERY.md "Disk full".',
    ],
});

// ------------------------------------------------------------ helpers

function result(id, title, status, summary, extra = {}) {
    return { id, title, status, summary, steps: [], ...extra };
}

/** #456: `unknown` results caused only by missing administrator rights.
 *  Kept out of the report object so its JSON stays pinned. */
const ADMIN_UNVERIFIED = new WeakSet();
function adminUnverified(check) {
    ADMIN_UNVERIFIED.add(check);
    return check;
}

/** True when some check is not OK and every such check is an
 *  administrator-rights unknown (versions, backups, proxy probe, clock
 *  sync time source). */
export function onlyAdminUnverified(report) {
    const notOk = report.checks.filter(
        (c) => c.status !== 'ok' && c.status !== 'info',
    );
    return notOk.length > 0 && notOk.every((c) => ADMIN_UNVERIFIED.has(c));
}

async function readJson(ctx, path) {
    try {
        return JSON.parse(await ctx.readText(path));
    } catch {
        return undefined;
    }
}

/** Access denied (not elevated), as opposed to a missing or corrupt file. */
export function isAccessDenied(error) {
    const code = error?.code ?? error?.cause?.code;
    return code === 'EACCES' || code === 'EPERM';
}

const UNVERIFIED_ADMIN = 'unverified (run as administrator)';

function gb(bytes) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function isLoopback(address) {
    const a = address.toLowerCase().replace(/^::ffff:/, '');
    return a === '::1' || a.startsWith('127.');
}

// ------------------------------------------------------------ checks

export async function checkVersions(ctx, paths, release) {
    let state;
    let denied = false;
    try {
        state = JSON.parse(
            await ctx.readText(join(paths.dirs.state, 'installer.json')),
        );
    } catch (error) {
        denied = isAccessDenied(error);
        state = undefined;
    }
    const releaseDir = release ?? state?.release;
    const info = releaseDir
        ? await readJson(ctx, join(releaseDir, 'VERSION.json'))
        : undefined;
    const details = {
        installedVersion: state?.version ?? null,
        installComplete: state?.complete ?? null,
        release: releaseDir ?? null,
        appVersion: info?.appVersion ?? null,
        commit: info?.commit ?? null,
        builtAt: info?.builtAt ?? null,
        components: info?.components
            ? Object.fromEntries(
                  Object.entries(info.components).map(([k, v]) => [
                      k,
                      v?.version ?? null,
                  ]),
              )
            : null,
    };
    if (denied)
        return adminUnverified(
            result(
                'versions',
                'Installed version',
                'unknown',
                `The installation record could not be read: ${UNVERIFIED_ADMIN}.`,
                { details },
            ),
        );
    if (!state?.complete) {
        return result(
            'versions',
            'Installed version',
            'fail',
            state
                ? `Installation ${state.version} did not finish.`
                : 'No installation record found.',
            { details, steps: GUIDANCE.notInstalled },
        );
    }
    if (!info) {
        return result(
            'versions',
            'Installed version',
            'warn',
            `Version ${state.version}; its VERSION.json is missing or unreadable.`,
            { details, steps: GUIDANCE.notInstalled },
        );
    }
    return result(
        'versions',
        'Installed version',
        'ok',
        `Grocery POS ${state.version} (app ${info.appVersion ?? '?'}, built ${info.builtAt ?? '?'}).`,
        { details },
    );
}

export async function checkServices(ctx) {
    const states = await ctx.serviceStates();
    if (!states) {
        return result(
            'services',
            'Services',
            'unknown',
            'Service state is only read on Windows.',
        );
    }
    const missing = Object.values(SERVICES).filter(
        (n) => states[n] === 'absent',
    );
    const stopped = Object.values(SERVICES).filter(
        (n) => states[n] !== 'absent' && states[n] !== 'RUNNING',
    );
    if (missing.length) {
        return result(
            'services',
            'Services',
            'fail',
            `Not installed: ${missing.join(', ')}.`,
            { details: states, steps: GUIDANCE.serviceMissing },
        );
    }
    if (stopped.length) {
        return result(
            'services',
            'Services',
            'fail',
            `Not running: ${stopped.map((n) => `${n} (${states[n]})`).join(', ')}.`,
            { details: states, steps: GUIDANCE.serviceStopped },
        );
    }
    return result(
        'services',
        'Services',
        'ok',
        'All three services are running.',
        {
            details: states,
        },
    );
}

const PORT_NAMES = [
    ['mongo', 'Database', PORTS.mongo, [LOOPBACK]],
    ['api', 'Application', PORTS.api, [LOOPBACK]],
    ['proxy', 'Browser address', PORTS.proxy, [LOOPBACK, '::1']],
];

/**
 * The LAN IP the proxy may also listen on (#396): the runtime manifest's,
 * and only if it is a private IPv4 address. Never for the API or MongoDB.
 * #499: also whether the manifest was refused (not elevated), so callers
 * report `unknown` instead of "no LAN terminals".
 */
async function lanConfig(ctx, paths) {
    if (!paths) return { lanIp: null, denied: false };
    let manifest;
    try {
        manifest = JSON.parse(await ctx.readText(paths.runtimeManifest));
    } catch (error) {
        return { lanIp: null, denied: isAccessDenied(error) };
    }
    const lanIp = manifest?.lanIp;
    return {
        lanIp: typeof lanIp === 'string' && isPrivateIpv4(lanIp) ? lanIp : null,
        denied: false,
    };
}

function lanUnverified(id, title, details) {
    return adminUnverified(
        result(
            id,
            title,
            'unknown',
            `The LAN terminal settings could not be read: ${UNVERIFIED_ADMIN}.`,
            details ? { details } : {},
        ),
    );
}

export async function checkPorts(ctx, paths) {
    // Only the LAN proxy service may listen on the LAN IP (#396): while it
    // is known not to run, a listener there is someone else's.
    const { lanIp: configured, denied } = await lanConfig(ctx, paths);
    const states = configured || denied ? await ctx.serviceStates() : null;
    // Any state but STOPPED/absent (e.g. START_PENDING, or a restart
    // under SCM recovery) may hold the LAN listener.
    const lanServiceDown =
        states &&
        (states[LAN_SERVICE] === 'STOPPED' ||
            states[LAN_SERVICE] === 'absent' ||
            states[LAN_SERVICE] === undefined);
    const lanIp = lanServiceDown ? null : configured;
    const details = {};
    const closed = [];
    const exposed = [];
    // #499: unreadable LAN settings leave a private-IPv4 proxy listener
    // unexplained, never proven foreign.
    const unverified = [];
    for (const [key, label, port, hosts] of PORT_NAMES) {
        const open = [];
        for (const host of hosts)
            if (await ctx.tcp(host, port)) open.push(host);
        const listening = await ctx.listeners(port);
        const allowed = (address) =>
            isLoopback(address) ||
            (key === 'proxy' &&
                lanIp !== null &&
                address.toLowerCase().replace(/^::ffff:/, '') === lanIp);
        let foreign = (listening ?? []).filter((a) => !allowed(a));
        // Only while the LAN service may run, and only one address: a
        // single LAN IP can be configured.
        if (key === 'proxy' && denied && states && !lanServiceDown) {
            const maybeLan = foreign.filter((a) =>
                isPrivateIpv4(a.toLowerCase().replace(/^::ffff:/, '')),
            );
            const distinct = new Set(
                maybeLan.map((a) => a.toLowerCase().replace(/^::ffff:/, '')),
            );
            if (distinct.size === 1) {
                unverified.push(`${label} (${port})`);
                foreign = foreign.filter((a) => !maybeLan.includes(a));
            }
        }
        details[key] = { port, reachable: open, listeners: listening };
        if (foreign.length) exposed.push(`${label} (${port})`);
        else if (open.length < hosts.length) closed.push(`${label} (${port})`);
    }
    if (exposed.length) {
        return result(
            'ports',
            'Ports (this PC only)',
            'fail',
            `Listening beyond this PC: ${exposed.join(', ')}.`,
            { details, steps: GUIDANCE.exposed },
        );
    }
    if (closed.length) {
        return result(
            'ports',
            'Ports (this PC only)',
            'fail',
            `Not answering: ${closed.join(', ')}.`,
            { details, steps: GUIDANCE.portClosed },
        );
    }
    if (unverified.length) {
        return adminUnverified(
            result(
                'ports',
                'Ports (this PC only)',
                'unknown',
                `Also listening on a LAN address: ${unverified.join(', ')}; the LAN terminal settings could not be read: ${UNVERIFIED_ADMIN}.`,
                { details: { ...details, lanIp: null } },
            ),
        );
    }
    return result(
        'ports',
        'Ports (this PC only)',
        'ok',
        lanIp
            ? `Database and application answer on this PC only; the LAN terminals' service also on ${lanIp}.`
            : 'Database, application and browser address answer on this PC only.',
        { details: { ...details, lanIp } },
    );
}

/**
 * The LAN terminals' proxy (#396), apart from the app: a stopped or
 * unreachable LAN service means terminals cannot connect, never that this
 * PC's register is down.
 */
export async function checkLanProxy(ctx, paths) {
    const title = 'LAN terminals';
    const { lanIp, denied } = await lanConfig(ctx, paths);
    if (denied) return lanUnverified('lanProxy', title);
    if (!lanIp)
        return result(
            'lanProxy',
            title,
            'info',
            'No LAN terminals are set up.',
        );
    const states = await ctx.serviceStates();
    const state = states?.[LAN_SERVICE];
    const details = { lanIp, service: LAN_SERVICE, state: state ?? null };
    if (state === 'absent')
        return result(
            'lanProxy',
            title,
            'fail',
            `LAN terminals are set up for ${lanIp} but ${LAN_SERVICE} is not installed.`,
            { details, steps: GUIDANCE.lanProxyMissing },
        );
    const listening = (await ctx.listeners(PORTS.proxy)) ?? [];
    const answering = listening.some(
        (a) => a.toLowerCase().replace(/^::ffff:/, '') === lanIp,
    );
    if ((state && state !== 'RUNNING') || (states && !answering))
        return result(
            'lanProxy',
            title,
            'warn',
            `LAN terminals cannot connect to ${lanIp}; this PC still works.`,
            {
                details: { ...details, listening: answering },
                steps: GUIDANCE.lanProxy,
            },
        );
    return result(
        'lanProxy',
        title,
        states ? 'ok' : 'unknown',
        states
            ? `LAN terminals connect to https://${lanIp}:${PORTS.proxy}.`
            : 'Service state is only read on Windows.',
        { details: { ...details, listening: answering } },
    );
}

/**
 * The time server for LAN terminals (#398): w32time running and the
 * NtpServer provider enabled. Read-only; facts it cannot read are `unknown`.
 */
export async function checkTimeServer(ctx, paths) {
    const title = 'Time for LAN terminals';
    const { lanIp, denied } = await lanConfig(ctx, paths);
    if (denied) return lanUnverified('timeServer', title);
    if (!lanIp)
        return result(
            'timeServer',
            title,
            'info',
            'No LAN terminals are set up.',
        );
    const facts = (await ctx.timeServer?.()) ?? null;
    const state = facts?.state ?? null;
    const enabled = facts?.ntpServerEnabled ?? null;
    const details = { lanIp, service: state, ntpServerEnabled: enabled };
    // Pending and unreadable states are unknown, not a warning.
    const running =
        state === 'RUNNING'
            ? true
            : ['STOPPED', 'PAUSED', 'absent'].includes(state)
              ? false
              : null;
    if (running === false || enabled === false)
        return result(
            'timeServer',
            title,
            'warn',
            'This PC is not serving time to the LAN terminals; their clocks will drift.',
            { details, steps: GUIDANCE.timeServer },
        );
    if (running === null || enabled === null)
        return result(
            'timeServer',
            title,
            'unknown',
            'Could not read the Windows time service settings.',
            { details },
        );
    return result(
        'timeServer',
        title,
        'ok',
        'This PC serves time to the LAN terminals.',
        { details },
    );
}

/**
 * The LAN terminals' network on this PC (#399): the fixed LAN IP is still on
 * a network adapter (DHCP drift), that network is Private, the firewall
 * rule is on, and the certificate served on the IP covers it (a TLS
 * handshake to this PC's own address, verified with the local root; never
 * unverified). Pieces that cannot be read are `unknown`, never `ok`.
 */
export async function checkLanNetwork(ctx, paths) {
    const title = 'LAN network';
    const { lanIp, denied } = await lanConfig(ctx, paths);
    if (denied) return lanUnverified('lanNetwork', title);
    if (!lanIp)
        return result(
            'lanNetwork',
            title,
            'info',
            'No LAN terminals are set up.',
        );
    const address = (await ctx.lanAddress?.(lanIp)) ?? null;
    const firewall = (await ctx.firewallRule?.(FIREWALL_RULE)) ?? null;
    const pem = await ctx
        .readText(caddyRootCertificate(paths))
        .catch(() => null);
    const tls =
        pem && address?.lanIpPresent !== false && ctx.tlsHandshake
            ? await ctx.tlsHandshake(lanIp, PORTS.proxy, pem)
            : null;
    const details = {
        lanIp,
        addressPresent: address?.lanIpPresent ?? null,
        profile: address?.lanProfile ?? null,
        firewallRule: firewall,
        tls: tls ? (tls.error ? 'failed' : 'verified') : 'unverified',
        tlsError: tls?.error ?? null,
    };
    const problems = [];
    const steps = [];
    let status = 'ok';
    const flag = (level, text, guidance) => {
        if (STATUS_RANK[level] > STATUS_RANK[status]) status = level;
        problems.push(text);
        steps.push(...guidance);
    };
    if (address?.lanIpPresent === false)
        flag('warn', `this PC no longer has ${lanIp}`, GUIDANCE.lanAddressGone);
    else if (address?.lanProfile === 'Public')
        flag('warn', 'the network is Public', GUIDANCE.lanPublic);
    if (firewall === 'missing' || firewall === 'disabled')
        flag('warn', `the firewall rule is ${firewall}`, GUIDANCE.lanFirewall);
    if (tls?.error)
        flag(
            'warn',
            `the certificate on ${lanIp} failed (${tls.error})`,
            GUIDANCE.lanCertificate,
        );
    if (problems.length)
        return result(
            'lanNetwork',
            title,
            status,
            `LAN terminals may not connect: ${problems.join('; ')}.`,
            { details, steps },
        );
    const unread =
        !address ||
        (address.lanIpPresent && !address.lanProfile) ||
        address.lanProfile === 'unknown' ||
        !firewall ||
        !tls;
    return result(
        'lanNetwork',
        title,
        unread ? 'unknown' : 'ok',
        unread
            ? 'Some LAN network facts could not be read (adapter and firewall only on Windows; the certificate only with the local root, run as administrator).'
            : `${lanIp} is on a Private network, the firewall rule is on and its certificate is valid.`,
        { details },
    );
}

export async function checkDatabase(ctx, apiDir) {
    const hello = await ctx.mongoHello(apiDir);
    if (hello.error) {
        // #489: an old CPU without AVX cannot run the database at all.
        const avx = ctx.avx ? await ctx.avx() : true;
        const hint = avx !== true;
        return result(
            'database',
            'Database',
            'fail',
            `The database does not answer (${hello.error})${hint ? '; the processor may not support AVX' : ''}.`,
            {
                steps: hint
                    ? [...GUIDANCE.noAvx, ...GUIDANCE.portClosed]
                    : GUIDANCE.portClosed,
            },
        );
    }
    const details = {
        setName: hello.setName ?? null,
        isWritablePrimary: Boolean(hello.isWritablePrimary),
    };
    if (hello.setName !== REPLICA_SET || !hello.isWritablePrimary) {
        return result(
            'database',
            'Database',
            'fail',
            'The database is running but not ready to accept sales yet.',
            { details, steps: GUIDANCE.databaseNotPrimary },
        );
    }
    return result(
        'database',
        'Database',
        'ok',
        'The database is running and ready (sign-in is checked by the application below).',
        { details },
    );
}

export async function checkApi(ctx) {
    const base = `http://${LOOPBACK}:${PORTS.api}/v1/health`;
    const live = await ctx.http(`${base}/live`);
    const ready = await ctx.http(`${base}/ready`);
    const details = {
        live: live.status ?? live.error,
        ready: ready.status ?? ready.error,
    };
    if (live.error && ready.error) {
        return result(
            'api',
            'Application',
            'fail',
            'The application is not running.',
            { details, steps: GUIDANCE.serviceStopped },
        );
    }
    if (ready.status !== 200) {
        return result(
            'api',
            'Application',
            'fail',
            'The application is running but cannot use the database (wrong sign-in or database down).',
            { details, steps: GUIDANCE.apiNotReady },
        );
    }
    if (live.status !== 200) {
        return result(
            'api',
            'Application',
            'warn',
            'The application works but reports memory or disk pressure.',
            { details, steps: GUIDANCE.apiUnhealthy },
        );
    }
    return result(
        'api',
        'Application',
        'ok',
        'The application is running and signed in to the database.',
        { details },
    );
}

export async function checkProxy(ctx, paths, now) {
    const pem = await ctx
        .readText(caddyRootCertificate(paths))
        .catch(() => null);
    let rootInfo = null;
    if (pem) {
        try {
            const cert = new X509Certificate(pem);
            rootInfo = { validTo: new Date(cert.validTo).toISOString() };
        } catch {
            rootInfo = { unreadable: true };
        }
    }
    if (!pem) {
        // Without the local root nothing can be verified: only check that
        // the port answers, and never talk HTTPS to an unverified peer.
        const open = await ctx.tcp('localhost', PORTS.proxy);
        const probe = result(
            'proxy',
            'Browser address (https://localhost:1443)',
            open ? 'unknown' : 'fail',
            open
                ? 'The port answers, but its certificate was not checked (unverified; run the check as administrator for a full check).'
                : 'The secure local address does not answer.',
            {
                details: { tls: 'unverified', portOpen: open, root: null },
                steps: open ? [] : GUIDANCE.proxy,
            },
        );
        return open ? adminUnverified(probe) : probe;
    }
    const res = await ctx.https(`${ORIGIN}/v1/health/ready`, pem);
    const details = {
        status: res.status ?? null,
        error: res.error ?? null,
        tls: res.error ? 'failed' : 'verified',
        root: rootInfo,
    };
    if (res.error) {
        return result(
            'proxy',
            'Browser address (https://localhost:1443)',
            'fail',
            `The secure local address does not answer (${res.error}).`,
            { details, steps: GUIDANCE.proxy },
        );
    }
    if (res.status !== 200) {
        return result(
            'proxy',
            'Browser address (https://localhost:1443)',
            'fail',
            `The secure local address answered ${res.status}.`,
            { details, steps: GUIDANCE.proxy },
        );
    }
    const daysLeft = rootInfo?.validTo
        ? (Date.parse(rootInfo.validTo) - now.getTime()) / DAY_MS
        : -1;
    if (daysLeft < 90) {
        return result(
            'proxy',
            'Browser address (https://localhost:1443)',
            'warn',
            daysLeft < 0
                ? 'The local certificate authority is unreadable or expired.'
                : `The local certificate authority expires in ${Math.floor(daysLeft)} days.`,
            { details, steps: GUIDANCE.certificate },
        );
    }
    return result(
        'proxy',
        'Browser address (https://localhost:1443)',
        'ok',
        'The secure local address works with its trusted local certificate.',
        { details },
    );
}

export async function checkDisk(ctx, paths, programDir) {
    const targets = [['data', paths.root]];
    if (programDir) targets.push(['program', programDir]);
    const details = {};
    let worst = 'ok';
    const notes = [];
    for (const [key, path] of targets) {
        const info = await ctx.freeSpace(path);
        if (!info) {
            details[key] = null;
            continue;
        }
        const usedFraction = 1 - info.free / info.total;
        details[key] = { free: info.free, total: info.total };
        if (usedFraction >= HEALTH.diskFullFraction) {
            worst = 'fail';
            notes.push(
                `${key} disk ${Math.round(usedFraction * 100)}% full (${gb(info.free)} free)`,
            );
        } else if (info.free < MIN_FREE.dataBytes) {
            if (worst === 'ok') worst = 'warn';
            notes.push(`${key} disk has ${gb(info.free)} free`);
        }
    }
    if (!Object.values(details).some(Boolean)) {
        return result(
            'disk',
            'Disk space',
            'unknown',
            'Free space could not be read.',
            {
                details,
            },
        );
    }
    if (worst === 'ok') {
        const free = details.data?.free;
        return result(
            'disk',
            'Disk space',
            'ok',
            free === undefined
                ? 'Enough free space.'
                : `${gb(free)} free on the data disk.`,
            { details },
        );
    }
    return result('disk', 'Disk space', worst, `${notes.join('; ')}.`, {
        details,
        steps: worst === 'fail' ? GUIDANCE.diskFull : GUIDANCE.diskLow,
    });
}

/** Backup state through the #363 interface (status.json), never files. */
export async function checkBackups(paths, now) {
    let summary;
    try {
        summary = statusSummary(await readStatus(paths), now);
    } catch (error) {
        if (isAccessDenied(error))
            return adminUnverified(
                result(
                    'backups',
                    'Backups',
                    'unknown',
                    `The backup status could not be read: ${UNVERIFIED_ADMIN}.`,
                ),
            );
        return result(
            'backups',
            'Backups',
            'fail',
            'The backup status could not be read.',
            { steps: GUIDANCE.backupStatusUnreadable },
        );
    }
    const pick = (entry) =>
        entry
            ? {
                  at: entry.at ?? null,
                  ...(entry.code ? { code: entry.code } : {}),
                  ...(entry.command ? { command: entry.command } : {}),
                  ...(entry.backupId ? { backupId: entry.backupId } : {}),
              }
            : null;
    const details = {
        lastAttempt: pick(summary.lastAttempt),
        lastSuccess: pick(summary.lastSuccess),
        lastVerifiedSuccess: pick(summary.lastVerifiedSuccess),
        lastFailure: summary.lastFailure
            ? {
                  ...pick(summary.lastFailure),
                  message: redact(summary.lastFailure.message ?? ''),
              }
            : null,
        consecutiveFailures: summary.consecutiveFailures,
        lastExport: pick(summary.lastExport),
        backupOverdue: summary.backupOverdue,
        exportReminderDue: summary.exportReminderDue,
    };
    const failureAt = Date.parse(summary.lastFailure?.at ?? '') || 0;
    const verifiedAt = Date.parse(summary.lastVerifiedSuccess?.at ?? '') || 0;
    const lastVerified = summary.lastVerifiedSuccess?.at
        ? `last verified backup ${summary.lastVerifiedSuccess.at}`
        : 'no verified backup yet';
    if (failureAt > verifiedAt && summary.lastFailure) {
        return result(
            'backups',
            'Backups',
            'fail',
            `The last ${summary.lastFailure.command ?? 'backup'} failed [${summary.lastFailure.code}]; ${lastVerified}.`,
            { details, steps: GUIDANCE.backupFailed },
        );
    }
    if (summary.backupOverdue) {
        return result(
            'backups',
            'Backups',
            'fail',
            `Backup overdue: ${lastVerified}.`,
            {
                details,
                steps: GUIDANCE.backupOverdue,
            },
        );
    }
    if (summary.exportReminderDue) {
        return result(
            'backups',
            'Backups',
            'warn',
            `${lastVerified[0].toUpperCase()}${lastVerified.slice(1)}; no USB copy in the last 7 days.`,
            { details, steps: GUIDANCE.exportDue },
        );
    }
    return result(
        'backups',
        'Backups',
        'ok',
        `${lastVerified[0].toUpperCase()}${lastVerified.slice(1)}; USB copy ${summary.lastExport.at}.`,
        { details },
    );
}

/**
 * Windows must keep this PC's own clock in sync (#446), LAN or not. On a
 * workgroup PC w32time is trigger-start and often stopped, which is fine;
 * it warns when the service is disabled or absent, when Set time
 * automatically is off (Type NoSync), or when the running service reads a
 * local clock source. Read-only; unreadable facts are `unknown`.
 */
export async function checkClockSync(ctx) {
    const title = 'Clock sync';
    const facts = (await ctx.clockSync?.()) ?? null;
    const state = facts?.state ?? null;
    const startType = facts?.startType ?? null;
    const syncType = facts?.syncType ?? null;
    const source = facts?.source ?? null;
    const details = { service: state, startType, syncType, source };
    const warn = (summary) =>
        result('clockSync', title, 'warn', summary, {
            details,
            steps: GUIDANCE.clockSync,
        });
    if (syncType === 'NoSync')
        return warn(
            'Set time automatically is off, so this PC clock is not kept in sync.',
        );
    if (state === 'absent' || startType === 'Disabled')
        return warn(
            'The Windows Time service is disabled, so this PC clock is not kept in sync.',
        );
    if (state === 'RUNNING' && syncedSource(source) === false)
        return warn('Windows is not syncing this PC clock with a time server.');
    if (state === null || startType === null || syncType === null)
        return result(
            'clockSync',
            title,
            'unknown',
            'Could not read the Windows time sync settings.',
            {
                details,
            },
        );
    // #481: a running service whose source can't be read is never ok.
    // Only access denied (`w32tm` needs administrator rights) is the
    // admin-only unverified case; any other failure is a plain unknown.
    if (state === 'RUNNING' && source === null) {
        if (facts?.sourceDenied === true)
            return adminUnverified(
                result(
                    'clockSync',
                    title,
                    'unknown',
                    `The Windows time source could not be read: ${UNVERIFIED_ADMIN}.`,
                    { details },
                ),
            );
        return result(
            'clockSync',
            title,
            'unknown',
            'Could not read the Windows time source.',
            { details },
        );
    }
    return result(
        'clockSync',
        title,
        'ok',
        'Windows keeps this PC clock in sync.',
        {
            details,
        },
    );
}

/** The clock must not be behind anything this installation recorded. */
export async function checkClock(ctx, paths, now) {
    const stamps = [];
    const state = await readJson(ctx, join(paths.dirs.state, 'installer.json'));
    for (const at of Object.values(state?.stages ?? {})) stamps.push(at);
    const status = await readJson(ctx, paths.backupStatus);
    if (status?.updatedAt) stamps.push(status.updatedAt);
    const latest = Math.max(0, ...stamps.map((s) => Date.parse(s) || 0));
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const details = {
        now: now.toISOString(),
        timezone,
        latestRecorded: latest ? new Date(latest).toISOString() : null,
    };
    if (latest && now.getTime() < latest - 5 * 60 * 1000) {
        return result(
            'clock',
            'Clock',
            'fail',
            `The PC clock (${details.now}) is behind the last recorded activity (${details.latestRecorded}).`,
            { details, steps: GUIDANCE.clock },
        );
    }
    return result(
        'clock',
        'Clock',
        'ok',
        `PC time ${details.now} (Windows time zone ${timezone}). The store's time zone is set in the app's Store settings.`,
        { details },
    );
}

/**
 * One log line, reduced and redacted. mongod's JSON lines keep only time,
 * severity, component, id and message (`attr` carries client addresses,
 * user names and query shapes and is dropped).
 */
export function logLine(line) {
    if (line.startsWith('{')) {
        try {
            const entry = JSON.parse(line);
            return redact(
                [entry.t?.$date, entry.s, entry.c, entry.id, entry.msg]
                    .filter((v) => v !== undefined)
                    .join(' '),
            );
        } catch {
            return '[unreadable log line]';
        }
    }
    return redact(line);
}

function isError(line) {
    if (line.startsWith('{')) {
        try {
            return ['E', 'F'].includes(JSON.parse(line).s);
        } catch {
            return false;
        }
    }
    return /\b(ERROR|FATAL|error|fatal|Error)\b/.test(line);
}

function splitLines(text) {
    return text.split(/\r?\n/).filter(Boolean);
}

/** Error lines from the end of each log, reduced and redacted. */
export function errorLines(text, limit = ERRORS_PER_SOURCE) {
    return splitLines(text).filter(isError).slice(-limit).map(logLine);
}

/** The log files of each source (database, application, proxy). */
async function logSources(ctx, paths) {
    const sources = [['database', [paths.mongodLog]]];
    for (const [name, dir] of [
        ['application', paths.apiLogs],
        ['proxy', paths.proxyLogs],
        // The LAN terminals' proxy (#396); empty without LAN terminals.
        ['proxyLan', paths.proxyLanLogs],
    ]) {
        const files = ((await ctx.list(dir)) ?? []).sort();
        sources.push([
            name,
            files
                .filter((f) => /\.(log|txt)$/i.test(f))
                .map((f) => join(dir, f)),
        ]);
    }
    return sources;
}

export async function checkLogs(ctx, paths) {
    const sources = await logSources(ctx, paths);
    const details = {};
    let mongodBytes = 0;
    for (const [name, files] of sources) {
        const lines = [];
        let bytes = 0;
        for (const file of files) {
            const tail = await ctx.tail(file, LOG_TAIL_BYTES);
            if (!tail) continue;
            bytes += tail.size;
            lines.push(...errorLines(tail.text));
        }
        if (name === 'database') mongodBytes = bytes;
        details[name] = { bytes, lastErrors: lines.slice(-ERRORS_PER_SOURCE) };
    }
    if (mongodBytes > MONGOD_LOG_WARN_BYTES) {
        return result(
            'logs',
            'Logs and last errors',
            'warn',
            `The database log is ${gb(mongodBytes)}.`,
            { details, steps: GUIDANCE.logs },
        );
    }
    const count = Object.values(details).reduce(
        (n, d) => n + d.lastErrors.length,
        0,
    );
    return result(
        'logs',
        'Logs and last errors',
        'info',
        count
            ? `${count} recent error line(s) below (secrets and personal names removed). Errors alone are not a problem if every other check is OK.`
            : 'No recent errors in the logs.',
        { details },
    );
}

// ------------------------------------------------------------ report

export async function diagnose(options, ctx = realContext()) {
    const paths = layout(resolve(options.dataRoot));
    const now = ctx.now();
    const state = await readJson(ctx, join(paths.dirs.state, 'installer.json'));
    const release = options.release ?? state?.release;
    const apiDir = options.api ?? (release ? join(release, 'api') : undefined);
    const programDir = release ? dirname(dirname(release)) : undefined;
    const checks = [
        await checkVersions(ctx, paths, options.release),
        await checkServices(ctx),
        await checkPorts(ctx, paths),
        await checkDatabase(ctx, apiDir),
        await checkApi(ctx),
        await checkProxy(ctx, paths, now),
        await checkLanProxy(ctx, paths),
        await checkLanNetwork(ctx, paths),
        await checkTimeServer(ctx, paths),
        await checkClockSync(ctx),
        await checkDisk(ctx, paths, programDir),
        await checkBackups(paths, now),
        await checkClock(ctx, paths, now),
        await checkLogs(ctx, paths),
    ];
    const overall = checks.reduce(
        (w, c) => (STATUS_RANK[c.status] > STATUS_RANK[w] ? c.status : w),
        'ok',
    );
    return {
        schema: REPORT_SCHEMA,
        generatedAt: now.toISOString(),
        overall,
        guide: release ? guidePath(release) : null,
        checks,
        notObserved: [
            'Pending offline cash receipts live in each browser; a shift cannot close until they are synchronized, so check the register screen instead.',
        ],
    };
}

const LABEL = {
    ok: 'OK',
    info: 'INFO',
    unknown: '??',
    warn: 'WARN',
    fail: 'FAIL',
};

/** #456: exit code of `check` for a report. Only unverified (`unknown`)
 *  lines is its own code, so a caller can tell it from a real warn/fail. */
export function checkExitCode(report) {
    if (report.overall === 'ok' || report.overall === 'info') return EXIT.OK;
    if (onlyAdminUnverified(report)) return EXIT.UNVERIFIED;
    return EXIT.ATTENTION;
}

export function renderText(report) {
    const out = [
        'Grocery POS diagnostics',
        `Checked ${report.generatedAt}. Nothing was changed or sent anywhere.`,
        '',
    ];
    for (const check of report.checks) {
        out.push(`[${LABEL[check.status]}] ${check.title}: ${check.summary}`);
        if (check.id === 'logs') {
            for (const [name, d] of Object.entries(check.details ?? {}))
                for (const line of d.lastErrors)
                    out.push(`      ${name}: ${line}`);
        }
        for (const step of check.steps) out.push(`      - ${step}`);
    }
    out.push('');
    for (const note of report.notObserved) out.push(`Note: ${note}`);
    out.push(
        report.overall === 'ok' || report.overall === 'info'
            ? 'Everything checked is OK.'
            : onlyAdminUnverified(report)
              ? 'Some checks need administrator rights; run as administrator for a full check.'
              : 'Something needs attention: follow the steps above.',
    );
    out.push(
        report.guide
            ? `Recovery guide: ${report.guide} (Start menu: "Grocery POS help").`
            : 'Recovery guide: Start menu, "Grocery POS help".',
    );
    return out.join('\n') + '\n';
}

// ------------------------------------------------------------ real context

function execCapture(file, args) {
    return new Promise((done) => {
        execFile(
            file,
            args,
            { windowsHide: true, timeout: 15000 },
            (error, stdout) =>
                done({
                    code: error ? (error.code ?? 1) : 0,
                    stdout: String(stdout ?? ''),
                }),
        );
    });
}

function tcp(host, port) {
    return new Promise((done) => {
        const socket = connect({ host, port });
        socket.setTimeout(1500);
        socket.once('connect', () => (socket.destroy(), done(true)));
        socket.once('timeout', () => (socket.destroy(), done(false)));
        socket.once('error', () => done(false));
    });
}

/** The firewall probe (#501). A rule that doesn't exist makes
 *  Get-NetFirewallRule fail with category ObjectNotFound, which with
 *  SilentlyContinue still leaves `$?` false and a nonzero exit, so it read
 *  as unreadable. The script catches it: ObjectNotFound prints `NotFound`
 *  (missing); any other error (e.g. a stopped MpsSvc or a CIM provider
 *  failure) exits 2 (unknown). */
export function firewallProbeScript() {
    return `try { $r = Get-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -ErrorAction Stop; [string]($r | Select-Object -First 1).Enabled } catch { if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { 'NotFound' } else { exit 2 } }`;
}

/** The probe's exit code and output to missing/enabled/disabled, or null
 *  (unreadable) for a failure or unexpected output. */
export function parseFirewallProbe(code, stdout) {
    if (code !== 0) return null;
    const value = stdout.trim();
    if (value === 'NotFound') return 'missing';
    if (value === 'True') return 'enabled';
    if (value === 'False') return 'disabled';
    return null;
}

/** The installer's adapter facts (#396): Preferred address lines with their
 *  NetworkCategory; Public on any adapter wins, and a present address
 *  without a readable category is 'unknown', never ok. */
export function parseLanAddress(stdout) {
    const categories = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('present|'))
        .map((line) => line.slice('present|'.length));
    return {
        lanIpPresent: categories.length > 0,
        lanProfile: categories.includes('Public')
            ? 'Public'
            : categories.length > 0
              ? (categories.find(Boolean) ?? 'unknown')
              : null,
    };
}

/** A TLS handshake to this PC's own LAN address, verified with the local
 *  root (Node checks the IP against the certificate's IP SANs). */
function tlsHandshake(host, port, ca) {
    return new Promise((done) => {
        const socket = tlsConnect({ host, port, ca, timeout: 5000 });
        socket.once('secureConnect', () => (socket.destroy(), done({})));
        socket.once(
            'timeout',
            () => (socket.destroy(), done({ error: 'TIMEOUT' })),
        );
        // A late error after destroy must not throw unhandled.
        socket.on('error', () => {});
        socket.once('error', (error) => done({ error: error.code ?? 'error' }));
    });
}

function httpGet(url, { ca } = {}) {
    const secure = url.startsWith('https:');
    if (secure && !ca) return Promise.resolve({ error: 'NO_CA' });
    return new Promise((done) => {
        const req = (secure ? httpsRequest : httpRequest)(
            url,
            {
                timeout: 5000,
                // HTTPS only with the local root; never unverified.
                ...(secure ? { ca } : {}),
            },
            (res) => {
                res.resume();
                done({ status: res.statusCode });
            },
        );
        req.once('error', (error) => done({ error: error.code ?? 'error' }));
        req.once('timeout', () =>
            req.destroy(Object.assign(new Error(), { code: 'TIMEOUT' })),
        );
        req.end();
    });
}

async function linuxListeners(port) {
    const hex = port.toString(16).toUpperCase().padStart(4, '0');
    const found = [];
    for (const [file, v6] of [
        ['/proc/net/tcp', false],
        ['/proc/net/tcp6', true],
    ]) {
        const text = await readFile(file, 'utf8').catch(() => '');
        for (const line of text.split('\n').slice(1)) {
            const [, local, , st] = line.trim().split(/\s+/);
            if (st !== '0A' || !local?.endsWith(`:${hex}`)) continue;
            const addr = local.split(':')[0];
            found.push(v6 ? decodeV6(addr) : decodeV4(addr));
        }
    }
    return found;
}

function decodeV4(hex) {
    return hex
        .match(/../g)
        .reverse()
        .map((b) => parseInt(b, 16))
        .join('.');
}

function decodeV6(hex) {
    const words = hex
        .match(/.{8}/g)
        .map((w) => w.match(/../g).reverse().join(''));
    const full = words.join('');
    if (/^0{32}$/.test(full)) return '::';
    if (/^0{31}1$/.test(full)) return '::1';
    if (full.startsWith('00000000000000000000ffff'))
        return `::ffff:${decodeV4(words[3].match(/../g).reverse().join(''))}`;
    return full.match(/.{4}/g).join(':');
}

/** The last `bytes` of a file, reading only that part (logs can be GBs). */
export async function tailFile(path, bytes) {
    let handle;
    try {
        handle = await open(path, 'r');
        const { size } = await handle.stat();
        const length = Math.min(size, bytes);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, size - length);
        let text = buffer.toString('utf8');
        // Drop the partial first line of a cut tail.
        if (length < size) text = text.slice(text.indexOf('\n') + 1);
        return { size, text };
    } catch {
        return null;
    } finally {
        await handle?.close();
    }
}

/**
 * The clock-sync facts printed by realContext().clockSync, one marker per
 * line: `svc=<Status>` (or notfound/error), `start=<StartType>` (or error),
 * `type=<W32Time Parameters\Type>` (or error) and `sync=<first line of
 * w32tm /query /source>` (or error; w32tm fails while the service is
 * stopped). Missing or `error` values are null (unknown).
 */
export function parseClockSync(stdout) {
    const values = {};
    for (const line of String(stdout ?? '').split(/\r?\n/)) {
        const m = /^(svc|start|type|sync)=(.*)$/.exec(line.trim());
        if (m) values[m[1]] = m[2].trim();
    }
    const read = (k) =>
        !values[k] || values[k] === 'error' ? null : values[k];
    const svc = read('svc');
    // #481: `sync=denied` is w32tm's access denied (0x80070005), set only then.
    const denied = values.sync === 'denied' ? { sourceDenied: true } : {};
    return {
        ...denied,
        state: !svc
            ? null
            : svc === 'notfound'
              ? 'absent'
              : serviceStateFromStatus(svc),
        startType: read('start'),
        syncType: read('type'),
        source: values.sync === 'denied' ? null : read('sync'),
    };
}

/**
 * Whether a w32tm source names a real time source, without reading
 * localized text: a peer name (optionally `,0x<flags>`) or the Hyper-V
 * provider. "Local CMOS Clock" in any language has spaces, so it is not.
 */
export function syncedSource(source) {
    if (source == null) return null;
    return (
        /^[^\s,]+(,0x[0-9a-f]+)?$/i.test(source) ||
        source === 'VM IC Time Synchronization Provider'
    );
}

/** Get-Service Status names (a locale-independent enum) to sc.exe's. */
/**
 * The time-server facts printed by realContext().timeServer: `svc=<Status>`
 * or `svc=notfound` (absent) or `svc=error` (unknown), and `ntp=<Enabled>`
 * or `ntp=error`. Missing or empty values are null (unknown).
 */
export function parseTimeServer(stdout) {
    const values = {};
    for (const line of String(stdout ?? '').split(/\r?\n/)) {
        const m = /^(svc|ntp)=(.*)$/.exec(line.trim());
        if (m) values[m[1]] = m[2].trim();
    }
    const svc = values.svc;
    const state =
        !svc || svc === 'error'
            ? null
            : svc === 'notfound'
              ? 'absent'
              : serviceStateFromStatus(svc);
    const ntp = values.ntp;
    return {
        state,
        ntpServerEnabled: ntp && /^\d+$/.test(ntp) ? Number(ntp) === 1 : null,
    };
}

export function serviceStateFromStatus(text) {
    const map = {
        Running: 'RUNNING',
        Stopped: 'STOPPED',
        StartPending: 'START_PENDING',
        StopPending: 'STOP_PENDING',
        Paused: 'PAUSED',
        PausePending: 'PAUSE_PENDING',
        ContinuePending: 'CONTINUE_PENDING',
    };
    const value = text.trim();
    if (value === '') return 'absent';
    return map[value] ?? 'UNKNOWN';
}

/** Every service whose state is read: the three, plus the LAN proxy (#396),
 *  reported as `absent` without LAN terminals. checkServices reads only
 *  SERVICES; checkPorts and checkLanProxy read LAN_SERVICE. */
export const QUERIED_SERVICES = Object.freeze([
    ...Object.values(SERVICES),
    LAN_SERVICE,
]);

export function realContext() {
    const windows = process.platform === 'win32';
    return {
        now: () => new Date(),
        readText: (path) => readFile(path, 'utf8'),
        list: (dir) => readdir(dir).catch(() => null),
        async tail(path, bytes) {
            return tailFile(path, bytes);
        },
        tcp,
        http: (url) => httpGet(url),
        https: (url, ca) => httpGet(url, { ca: ca ?? undefined }),
        async serviceStates() {
            if (!windows) return null;
            const out = {};
            for (const name of QUERIED_SERVICES) {
                // The Status enum name is not localized (sc.exe's text may be).
                const { code, stdout } = await execCapture('powershell.exe', [
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    `$s = Get-Service -Name '${name}' -ErrorAction SilentlyContinue; if ($s) { [string]$s.Status }`,
                ]);
                out[name] =
                    code === 0 ? serviceStateFromStatus(stdout) : 'UNKNOWN';
            }
            return out;
        },
        async listeners(port) {
            if (!windows)
                return process.platform === 'linux'
                    ? linuxListeners(port)
                    : null;
            const { code, stdout } = await execCapture('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `Get-NetTCPConnection -State Listen -LocalPort ${Number(port)} -ErrorAction SilentlyContinue | ForEach-Object { $_.LocalAddress }`,
            ]);
            return code === 0
                ? stdout
                      .split(/\r?\n/)
                      .map((l) => l.trim())
                      .filter(Boolean)
                : null;
        },
        async clockSync() {
            if (!windows) return null;
            // Read-only: Get-Service, the W32Time Type value and w32tm's
            // source query (only the source text is localized; see syncedSource).
            const { code, stdout } = await execCapture('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                "try { $s = Get-Service -Name 'w32time' -ErrorAction Stop; 'svc=' + [string]$s.Status; 'start=' + [string]$s.StartType } catch [Microsoft.PowerShell.Commands.ServiceCommandException] { if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { 'svc=notfound' } else { 'svc=error' } } catch { 'svc=error' }; try { 'type=' + [string](Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\W32Time\\Parameters' -Name Type -ErrorAction Stop).Type } catch { 'type=error' }; $o = & w32tm.exe /query /source 2>&1; if ($LASTEXITCODE -eq 0 -and $o) { 'sync=' + [string]($o | Select-Object -First 1) } elseif ($LASTEXITCODE -eq -2147024891 -or (($o | Out-String) -match '0x80070005')) { 'sync=denied' } else { 'sync=error' }",
            ]);
            return code === 0 ? parseClockSync(stdout) : null;
        },
        async timeServer() {
            if (!windows) return null;
            // One call; every failure prints its own marker (parseTimeServer).
            const { code, stdout } = await execCapture('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                "try { 'svc=' + [string](Get-Service -Name 'w32time' -ErrorAction Stop).Status } catch [Microsoft.PowerShell.Commands.ServiceCommandException] { if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { 'svc=notfound' } else { 'svc=error' } } catch { 'svc=error' }; try { 'ntp=' + [string](Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\W32Time\\TimeProviders\\NtpServer' -Name Enabled -ErrorAction Stop).Enabled } catch { 'ntp=error' }",
            ]);
            return code === 0 ? parseTimeServer(stdout) : null;
        },
        async lanAddress(lanIp) {
            if (!windows) return null;
            // Same query as the installer's preflight (install.mjs).
            const { code, stdout } = await execCapture('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `Get-NetIPAddress -AddressFamily IPv4 -IPAddress '${lanIp}' -AddressState Preferred -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue; 'present|' + [string]$p.NetworkCategory }`,
            ]);
            return code === 0 ? parseLanAddress(stdout) : null;
        },
        async firewallRule(name) {
            if (!windows) return null;
            const { code, stdout } = await execCapture('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                firewallProbeScript(),
            ]);
            return parseFirewallProbe(code, stdout);
        },
        tlsHandshake,
        async avx() {
            if (!windows) return null;
            return parseAvxProbe(
                await execCapture('powershell.exe', [
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    AVX_PROBE_COMMAND,
                ]),
            );
        },
        async mongoHello(apiDir) {
            if (!apiDir) return { error: 'release not found' };
            let client;
            try {
                const { MongoClient } = createRequire(
                    join(resolve(apiDir), 'package.json'),
                )('mongoose').mongo;
                // No credentials: `hello` is allowed before authentication.
                client = new MongoClient(
                    `mongodb://${LOOPBACK}:${PORTS.mongo}/?directConnection=true`,
                    { serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000 },
                );
                await client.connect();
                const hello = await client.db('admin').command({ hello: 1 });
                return {
                    setName: hello.setName,
                    isWritablePrimary: hello.isWritablePrimary,
                };
            } catch (error) {
                return { error: error.name ?? 'error' };
            } finally {
                await client?.close().catch(() => {});
            }
        },
        async freeSpace(path) {
            let current = path;
            for (;;) {
                const info = await statfs(current).catch(() => undefined);
                if (info)
                    return {
                        free: info.bavail * info.bsize,
                        total: info.blocks * info.bsize,
                    };
                const parent = dirname(current);
                if (parent === current) return undefined;
                current = parent;
            }
        },
    };
}

// ------------------------------------------------------------ log rotation

/**
 * Rotates mongod.log (`logRotate`, mongod.cfg's `logRotate: rename`) and
 * keeps the newest `keep` rotated files. API/proxy logs are rolled by
 * WinSW (10 MB × 5, runtime/layout.mjs).
 */
export async function rotateLogs(options) {
    const paths = layout(resolve(options.dataRoot));
    const keep = options.keep ?? ROTATED_LOGS_KEPT;
    const { MongoClient } = createRequire(
        join(resolve(options.api), 'package.json'),
    )('mongoose').mongo;
    let password;
    try {
        password = (
            await readFile(paths.secrets.mongoRootPassword, 'utf8')
        ).trim();
    } catch {
        throw new RotateError(
            'the database password could not be read (run as administrator or SYSTEM)',
        );
    }
    const client = new MongoClient(
        `mongodb://${LOOPBACK}:${PORTS.mongo}/?directConnection=true`,
        {
            auth: { username: DB_USERS.root, password },
            authSource: 'admin',
            serverSelectionTimeoutMS: 3000,
        },
    );
    try {
        await client.connect();
        await client.db('admin').command({ logRotate: 'server' });
    } catch (error) {
        throw new RotateError(rotateReason(error));
    } finally {
        await client.close();
    }
    const base = 'mongod.log.';
    const rotated = (await readdir(paths.dirs.logs))
        .filter((f) => f.startsWith(base))
        .sort()
        .reverse();
    const removed = rotated.slice(keep);
    for (const file of removed)
        await rm(join(paths.dirs.logs, file), { force: true });
    return { kept: rotated.slice(0, keep), removed };
}

export class RotateError extends Error {}

/** A fixed reason per failure class; never the driver's own message. */
export function rotateReason(error) {
    const name = error?.name ?? '';
    if (
        error?.code === 18 ||
        /Authentication/i.test(error?.message ?? '') ||
        error?.codeName === 'AuthenticationFailed'
    )
        return 'the database refused the maintenance sign-in (credentials)';
    if (/ServerSelection|NetworkError|Timeout/.test(name))
        return 'the database is not running';
    if (error?.code === 13 || error?.codeName === 'Unauthorized')
        return 'the maintenance account may not rotate logs';
    return `the database refused (${error?.codeName ?? (name || 'Error')})`;
}

// ------------------------------------------------------------ support export

/** Exactly what a support export contains (README "Support export"). */
export const EXPORT_INCLUDES = Object.freeze([
    'The full check report shown by "Check Grocery POS" (versions, services, ports, database/application/address state, disk space, backup status, clock, recent error lines).',
    `The last ${EXPORT_LINES_PER_FILE} lines of each log file (database, application, proxy, LAN proxy), redacted.`,
    'Removed from every line: secrets, passwords, tokens, cookies, connection strings, e-mail addresses, user names, quoted text and IP addresses; database log lines keep only time, severity, component, id and message.',
    'Not included: database contents, sales or customer data, backups, secrets, certificates or configuration files.',
]);

function isInside(child, parent) {
    const rel = resolve(child).toLowerCase();
    const base = resolve(parent).toLowerCase();
    return (
        rel === base ||
        rel.startsWith(`${base}/`) ||
        rel.startsWith(`${base}\\`)
    );
}

// Every IP address in the report: IPv6 (full or compressed, IPv4-mapped in
// dotted or hex form, with a zone suffix), then IPv4.
const IPV6 =
    /(?<![\w:.%])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?(?::(?:\d{1,3}\.){3}\d{1,3})?)(?:%[\w.-]+)?(?![\w:.%])/gi;
const IPV4 = /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g;
const KEPT_IPV6 = new Set(['::1', '::']);

/**
 * Replaces every IP address in every string of a value (check summaries,
 * steps, details, structured `lanIp` fields) with `[ip]`, for the support
 * export (#500). Only loopback (127/8, ::1) and unspecified (0.0.0.0, ::)
 * addresses stay readable; keys stay.
 */
export function scrubIps(value) {
    if (typeof value === 'string')
        return value
            .replace(IPV6, (ip) =>
                KEPT_IPV6.has(ip.toLowerCase()) ? ip : '[ip]',
            )
            .replace(IPV4, (ip) =>
                ip.startsWith('127.') || ip === '0.0.0.0' ? ip : '[ip]',
            );
    if (Array.isArray(value)) return value.map(scrubIps);
    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, scrubIps(v)]),
        );
    return value;
}

export async function supportExport(options, ctx = realContext()) {
    const paths = layout(resolve(options.dataRoot));
    const to = resolve(options.to);
    if (isInside(to, paths.root))
        throw new Error(
            'Choose a folder outside the Grocery POS data folder (for example a USB drive).',
        );
    const info = await stat(to).catch(() => null);
    if (!info?.isDirectory())
        throw new Error('The chosen folder does not exist.');
    const report = scrubIps(await diagnose(options, ctx));
    const logs = {};
    for (const [name, files] of await logSources(ctx, paths)) {
        logs[name] = [];
        for (const file of files) {
            const tail = await ctx.tail(file, LOG_TAIL_BYTES);
            if (!tail) continue;
            logs[name].push(
                ...splitLines(tail.text)
                    .slice(-EXPORT_LINES_PER_FILE)
                    .map(logLine),
            );
        }
    }
    const content = {
        schema: 1,
        kind: 'grocery-pos-support-export',
        createdAt: report.generatedAt,
        includes: EXPORT_INCLUDES,
        report,
        logs,
    };
    const stamp = report.generatedAt.replace(/[:.]/g, '-');
    const file = join(to, `GroceryPOS-support-${stamp}.json`);
    await mkdir(to, { recursive: true });
    await writeFile(file, JSON.stringify(content, null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600,
    });
    return file;
}

// ------------------------------------------------------------ cli

export function parseArgs(args) {
    const [command, ...rest] = args;
    if (!['check', 'export', 'rotate-logs'].includes(command))
        throw new Error(
            'Usage: diagnose.mjs check|export|rotate-logs --data-root <abs> …',
        );
    const options = { command };
    const names = {
        '--data-root': 'dataRoot',
        '--release': 'release',
        '--api': 'api',
        '--keep': 'keep',
        '--to': 'to',
    };
    for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === '--json' && command === 'check') {
            options.json = true;
            continue;
        }
        const key = names[arg];
        const value = rest[i + 1];
        if (!key || value === undefined || value.startsWith('--'))
            throw new Error(`Unknown or incomplete option ${arg}.`);
        options[key] = key === 'keep' ? Number(value) : value;
        i++;
    }
    if (!options.dataRoot) throw new Error('--data-root is required.');
    if (command === 'export' && !options.to)
        throw new Error('--to is required.');
    if (command !== 'export' && options.to)
        throw new Error('--to is only for export.');
    if (command === 'rotate-logs') {
        if (!options.api) throw new Error('--api is required.');
        if (!Number.isInteger(options.keep ?? 1) || (options.keep ?? 1) < 1)
            throw new Error('--keep must be a positive integer.');
    }
    return options;
}

async function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return EXIT.USAGE;
    }
    if (options.command === 'rotate-logs') {
        try {
            const { kept, removed } = await rotateLogs(options);
            process.stdout.write(
                `Database log rotated; kept ${kept.length}, removed ${removed.length} old file(s).\n`,
            );
            return EXIT.OK;
        } catch (error) {
            process.stderr.write(
                error instanceof RotateError
                    ? `Failed: could not rotate the database log: ${error.message}.\n`
                    : `Failed (${error.name ?? 'Error'}): could not rotate the database log.\n`,
            );
            return EXIT.ATTENTION;
        }
    }
    if (options.command === 'export') {
        try {
            const file = await supportExport(options);
            process.stdout.write(
                `Support file saved: ${file}\nIt contains the check report and redacted recent log lines only. Give it to your vendor; nothing was sent anywhere.\n`,
            );
            return EXIT.OK;
        } catch (error) {
            process.stderr.write(
                `Failed: ${error.code === 'EEXIST' ? 'a support file with this name already exists' : error.code ? `the file could not be written (${error.code})` : error.message}\n`,
            );
            return EXIT.ATTENTION;
        }
    }
    const report = await diagnose(options);
    process.stdout.write(
        options.json
            ? JSON.stringify(report, null, 2) + '\n'
            : renderText(report),
    );
    return checkExitCode(report);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    process.exit(await main());
}
