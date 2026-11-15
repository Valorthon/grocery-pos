// Single-PC operator diagnostics (#365): a local, read-only health report
// with plain recovery steps. No network beyond loopback, no upload, no
// telemetry, never reads secrets\ and grants no application role.
//
//   node diagnose.mjs check --data-root <abs> [--release <abs>] [--json]
//   node diagnose.mjs rotate-logs --data-root <abs> --api <release\api> [--keep N]
//
// `check` exits 0 when everything is OK, 1 when something needs attention
// (warn or fail), 2 on a usage error. `rotate-logs` is a maintenance
// command (reads the MongoDB root password; run it elevated or as SYSTEM).
// See README.md and RECOVERY.md.
import { execFile } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { readFile, readdir, rm, stat, statfs } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readStatus, statusSummary } from '../backup/backup.mjs';
import { caddyRootCertificate, MIN_FREE } from '../installer/plan.mjs';
import {
    DB_USERS,
    HEALTH,
    LOOPBACK,
    ORIGIN,
    PORTS,
    REPLICA_SET,
    SERVICES,
    layout,
} from '../runtime/layout.mjs';

export const EXIT = { OK: 0, ATTENTION: 1, USAGE: 2 };
export const STATUS_RANK = { ok: 0, info: 0, unknown: 1, warn: 2, fail: 3 };
/** Bytes of each log read from its end; error lines kept per source. */
export const LOG_TAIL_BYTES = 256 * 1024;
export const ERRORS_PER_SOURCE = 5;
/** mongod.log above this asks for `rotate-logs`. */
export const MONGOD_LOG_WARN_BYTES = 100 * 1024 ** 2;
export const ROTATED_LOGS_KEPT = 5;
const DAY_MS = 24 * 3600 * 1000;

// ------------------------------------------------------------ redaction

const REDACTIONS = [
    // Connection strings with credentials.
    [/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi, '$1[redacted]@'],
    // key=value / key: value / "key":"value" for secret-ish keys.
    [
        /(["']?\b(?:password|passwd|pwd|secret|token|cookie|set-cookie|authorization|pin|api[-_]?key|jwt[-_]?secret|cookie[-_]?secret|database[-_]?url)\b["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi,
        '$1[redacted]',
    ],
    [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [redacted]'],
    // JWTs.
    [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[redacted-jwt]'],
    // Long base64/base64url runs (generated secrets are 64+ characters).
    // Request ids (UUIDs, 36 characters) stay readable.
    [/[A-Za-z0-9+_-]{40,}={0,2}/g, '[redacted]'],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
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

async function readJson(ctx, path) {
    try {
        return JSON.parse(await ctx.readText(path));
    } catch {
        return undefined;
    }
}

function gb(bytes) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function isLoopback(address) {
    const a = address.toLowerCase().replace(/^::ffff:/, '');
    return a === '::1' || a.startsWith('127.');
}

// ------------------------------------------------------------ checks

export async function checkVersions(ctx, paths, release) {
    const state = await readJson(ctx, join(paths.dirs.state, 'installer.json'));
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

export async function checkPorts(ctx) {
    const details = {};
    const closed = [];
    const exposed = [];
    for (const [key, label, port, hosts] of PORT_NAMES) {
        const open = [];
        for (const host of hosts)
            if (await ctx.tcp(host, port)) open.push(host);
        const listening = await ctx.listeners(port);
        const foreign = (listening ?? []).filter((a) => !isLoopback(a));
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
    return result(
        'ports',
        'Ports (this PC only)',
        'ok',
        'Database, application and browser address answer on this PC only.',
        { details },
    );
}

export async function checkDatabase(ctx, apiDir) {
    const hello = await ctx.mongoHello(apiDir);
    if (hello.error) {
        return result(
            'database',
            'Database',
            'fail',
            `The database does not answer (${hello.error}).`,
            { steps: GUIDANCE.portClosed },
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
    const res = await ctx.https(`${ORIGIN}/v1/health/ready`, pem);
    const details = {
        status: res.status ?? null,
        error: res.error ?? null,
        tlsVerified: Boolean(pem) && !res.error,
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
    if (!pem) {
        return result(
            'proxy',
            'Browser address (https://localhost:1443)',
            'unknown',
            'It answers, but its certificate could not be checked (run this check as administrator).',
            { details },
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
    } catch {
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

/** Error lines from the end of each log, redacted. */
export function errorLines(text, limit = ERRORS_PER_SOURCE) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    const errors = lines.filter((line) => {
        if (line.startsWith('{')) {
            try {
                return ['E', 'F'].includes(JSON.parse(line).s);
            } catch {
                return false;
            }
        }
        return /\b(ERROR|FATAL|error|fatal|Error)\b/.test(line);
    });
    return errors.slice(-limit).map(redact);
}

export async function checkLogs(ctx, paths) {
    const sources = [['database', [paths.mongodLog]]];
    for (const [name, dir] of [
        ['application', paths.apiLogs],
        ['proxy', paths.proxyLogs],
    ]) {
        const files = (await ctx.list(dir)) ?? [];
        sources.push([
            name,
            files
                .filter((f) => /\.(log|txt)$/i.test(f))
                .map((f) => join(dir, f)),
        ]);
    }
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
        await checkPorts(ctx),
        await checkDatabase(ctx, apiDir),
        await checkApi(ctx),
        await checkProxy(ctx, paths, now),
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
        schema: 1,
        generatedAt: now.toISOString(),
        overall,
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
            : 'Something needs attention: follow the steps above (RECOVERY.md has the details).',
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

function httpGet(url, { ca } = {}) {
    const secure = url.startsWith('https:');
    return new Promise((done) => {
        const req = (secure ? httpsRequest : httpRequest)(
            url,
            {
                timeout: 5000,
                ...(secure
                    ? ca
                        ? { ca }
                        : { rejectUnauthorized: false }
                    : {}),
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

export function realContext() {
    const windows = process.platform === 'win32';
    return {
        now: () => new Date(),
        readText: (path) => readFile(path, 'utf8'),
        list: (dir) => readdir(dir).catch(() => null),
        async tail(path, bytes) {
            try {
                const info = await stat(path);
                const buffer = await readFile(path);
                return {
                    size: info.size,
                    text: buffer
                        .subarray(Math.max(0, buffer.length - bytes))
                        .toString('utf8'),
                };
            } catch {
                return null;
            }
        },
        tcp,
        http: (url) => httpGet(url),
        https: (url, ca) => httpGet(url, { ca: ca ?? undefined }),
        async serviceStates() {
            if (!windows) return null;
            const out = {};
            for (const name of Object.values(SERVICES)) {
                const { code, stdout } = await execCapture('sc.exe', [
                    'query',
                    name,
                ]);
                out[name] =
                    code === 1060
                        ? 'absent'
                        : (/STATE\s+:\s+\d+\s+(\w+)/.exec(stdout)?.[1] ??
                          'UNKNOWN');
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
    const password = (
        await readFile(paths.secrets.mongoRootPassword, 'utf8')
    ).trim();
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

// ------------------------------------------------------------ cli

export function parseArgs(args) {
    const [command, ...rest] = args;
    if (!['check', 'rotate-logs'].includes(command))
        throw new Error(
            'Usage: diagnose.mjs check|rotate-logs --data-root <abs> …',
        );
    const options = { command };
    const names = {
        '--data-root': 'dataRoot',
        '--release': 'release',
        '--api': 'api',
        '--keep': 'keep',
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
                `Failed (${error.name ?? 'Error'}): could not rotate the database log.\n`,
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
    return report.overall === 'ok' || report.overall === 'info'
        ? EXIT.OK
        : EXIT.ATTENTION;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    process.exit(await main());
}
