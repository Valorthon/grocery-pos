// Single-PC backups (#363): consistent, verified, retained, exportable.
// Owner-operable commands; restore is the separate restore.mjs. See README.md.
//
//   node backup.mjs create --data-root <abs> --mongod <mongod> --tools <dir> --api <api dir>
//       [--kind scheduled|manual] [--reserve-mb <n>]
//   node backup.mjs verify --data-root <abs> --mongod <mongod> --tools <dir> --api <api dir>
//       [--backup <id> | --from <backup dir>]
//   node backup.mjs export --data-root <abs> --to <removable drive folder> [--backup <id>]
//   node backup.mjs prune  --data-root <abs>
//   node backup.mjs status --data-root <abs>
//
// Exit codes: 0 ok, 1 failure (recorded in backups\status.json), 2 usage,
// 3 refused (nothing changed). Output never carries secrets.
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
    chmod,
    copyFile,
    mkdir,
    readdir,
    readFile,
    rename,
    rm,
    stat,
    statfs,
    writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedWait } from '../proof/policy.mjs';
import {
    APP_DATABASE,
    DB_USERS,
    LOOPBACK,
    PORTS,
    REPLICA_SET,
    RUNTIME_DATABASE,
    SECRET_FILES,
    layout,
    secretPattern,
} from '../runtime/layout.mjs';
import {
    RefusedError,
    acquireLock,
    releaseLock,
} from '../runtime/provision.mjs';
import { destinationMedia } from './removable.mjs';

export { RefusedError };
export const EXIT = { OK: 0, FAILED: 1, USAGE: 2, REFUSED: 3 };
export const BACKUP_SCHEMA = 1;
export const STATUS_SCHEMA = 1;
/** Owner decisions (#363/#357): daily backups kept 30 days, weekly export reminder. */
export const RETENTION_DAYS = 30;
export const EXPORT_REMINDER_DAYS = 7;
/** A daily schedule that has not produced a verified backup for this long is overdue. */
export const OVERDUE_HOURS = 36;
export const DEFAULT_RESERVE_MB = 256;
export const KINDS = Object.freeze(['scheduled', 'manual', 'pre-restore']);
const DAY_MS = 24 * 60 * 60 * 1000;

export const ARCHIVE = 'database.archive.gz';
export const MANIFEST = 'manifest.json';
export const MANIFEST_SUM = 'manifest.sha256';
export const VERIFICATION = 'verification.json';
const INCOMPLETE = '.incomplete-';
/** The throwaway test-restore instance's only user (random password). */
const VERIFY_USER = 'gpos_verify';
const SCRATCH = '.verify-';
export const ID_PATTERN =
    /^\d{8}T\d{6}Z-(scheduled|manual|pre-restore)-[0-9a-f]{6}$/;
export const EXPORT_PREFIX = 'GroceryPOS-backup-';

/**
 * What a backup carries besides the database, and what it leaves out.
 * The secrets are required for a replacement-PC restore: the database
 * users' passwords, the replica-set keyfile, and the JWT secret that
 * signs offline cost evidence and leases (#37). The cookie secret is left
 * out: a restore issues a new one, which ends every pre-restore session
 * (access tokens are only accepted from cookies it signs). Exported copies
 * are owner-approved plaintext (#357), so possession exposes them.
 */
export const BACKED_UP_SECRETS = Object.freeze(
    Object.keys(SECRET_FILES).filter((key) => key !== 'cookieSecret'),
);
export const INCLUDED_FILES = Object.freeze([
    ...BACKED_UP_SECRETS.map((key) => `secrets/${SECRET_FILES[key].file}`),
    'state/install.json',
    'config/runtime.json',
]);
export const EXCLUDED = Object.freeze([
    {
        path: 'secrets/cookie-secret',
        reason: 'signs session cookies only; a restore generates a new one so every pre-restore session ends',
    },
    {
        path: 'secrets/api.env',
        reason: 'derived from the secrets; provisioning rewrites it',
    },
    {
        path: 'config/mongod.cfg',
        reason: 'derived; provisioning rewrites it for the target paths',
    },
    {
        path: 'tls/',
        reason: "the local CA is trusted per machine; a replacement PC's installer creates and trusts its own (#358/#362)",
    },
    { path: 'logs/', reason: 'diagnostic only; may hold machine details' },
    {
        path: 'database/',
        reason: 'live files are never copied; the database is in the mongodump archive',
    },
    {
        path: 'browser storage',
        reason: 'parked tickets and queued offline cash live in Chrome (localStorage/IndexedDB), not on the server; see README "Browser data"',
    },
    {
        path: 'local database',
        reason: 'replica-set state and oplog are per machine; the oplog written during the dump is in the archive',
    },
]);
/**
 * The archive holds every database mongodump copies (grocery, the
 * gpos_runtime installation marker, and admin's two database users, as
 * SCRAM hashes). mongorestore refuses namespace filters with
 * --oplogReplay, so a restore always restores all of it; the users match
 * the backed-up secrets the restore also places.
 */
export const ARCHIVE_DATABASES = Object.freeze([
    APP_DATABASE,
    RUNTIME_DATABASE,
    'admin',
]);

/** Fixed failure codes for status.json; diagnostics (#365) map them to guidance. */
export class BackupError extends Error {
    constructor(code, message, detail) {
        super(message);
        this.name = 'BackupError';
        this.code = code;
        this.detail = detail;
    }
}

// ---------------------------------------------------------------- args

const OPTIONS = {
    'data-root': 'dataRoot',
    mongod: 'mongod',
    tools: 'tools',
    api: 'api',
    kind: 'kind',
    'reserve-mb': 'reserveMb',
    backup: 'backup',
    from: 'from',
    to: 'to',
    confirm: 'confirm',
};
const FLAGS = {
    // Test harnesses only (a CI runner has no removable drive); the
    // installer never exposes it.
    'test-allow-fixed-destination': 'testAllowFixedDestination',
    'accept-open-shifts': 'acceptOpenShifts',
    'accept-newer-sales': 'acceptNewerSales',
    'accept-pending-offline': 'acceptPendingOffline',
};

export const COMMANDS = Object.freeze({
    create: { required: ['dataRoot', 'mongod', 'tools', 'api'] },
    verify: { required: ['dataRoot', 'mongod', 'tools', 'api'] },
    export: { required: ['dataRoot', 'to'] },
    prune: { required: ['dataRoot'] },
    status: { required: ['dataRoot'] },
});

/** Parses `--name value` options and `--flag`s; each at most once. */
export function parseOptions(args, required, allowed) {
    const out = {};
    for (let i = 0; i < args.length; i++) {
        const name = args[i]?.startsWith('--') ? args[i].slice(2) : undefined;
        if (name && Object.hasOwn(FLAGS, name) && allowed.includes(name)) {
            if (Object.hasOwn(out, FLAGS[name]))
                throw new Error(`--${name} given twice.`);
            out[FLAGS[name]] = true;
            continue;
        }
        const value = args[i + 1];
        if (
            !name ||
            !Object.hasOwn(OPTIONS, name) ||
            !allowed.includes(name) ||
            value === undefined ||
            value.startsWith('--') ||
            Object.hasOwn(out, OPTIONS[name])
        ) {
            throw new Error('Expected each documented option at most once.');
        }
        out[OPTIONS[name]] = value;
        i++;
    }
    for (const key of required) {
        if (!out[key]) {
            const flag = Object.keys(OPTIONS).find((k) => OPTIONS[k] === key);
            throw new Error(`--${flag} is required.`);
        }
    }
    for (const key of ['dataRoot', 'to', 'from']) {
        if (out[key] !== undefined && !isAbsolute(out[key]))
            throw new Error(
                `--${key === 'dataRoot' ? 'data-root' : key} must be an absolute path.`,
            );
    }
    if (out.kind !== undefined && !['scheduled', 'manual'].includes(out.kind))
        throw new Error('--kind must be scheduled or manual.');
    if (out.reserveMb !== undefined) {
        const mb = Number(out.reserveMb);
        if (!Number.isSafeInteger(mb) || mb < 0 || mb > 1024 * 1024)
            throw new Error('--reserve-mb must be a whole number of MB.');
        out.reserveMb = mb;
    }
    if (out.backup !== undefined && !ID_PATTERN.test(out.backup))
        throw new Error('--backup must be a backup id.');
    if (out.backup !== undefined && out.from !== undefined)
        throw new Error('Give --backup or --from, not both.');
    return out;
}

const ALLOWED = {
    create: ['data-root', 'mongod', 'tools', 'api', 'kind', 'reserve-mb'],
    verify: ['data-root', 'mongod', 'tools', 'api', 'backup', 'from'],
    export: [
        'data-root',
        'to',
        'backup',
        'test-allow-fixed-destination',
        'reserve-mb',
    ],
    prune: ['data-root'],
    status: ['data-root'],
};

export function parseArgs(args) {
    const [command, ...rest] = args;
    if (!Object.hasOwn(COMMANDS, command ?? ''))
        throw new Error(
            `Command must be one of ${Object.keys(COMMANDS).join(', ')}.`,
        );
    return {
        command,
        ...parseOptions(rest, COMMANDS[command].required, ALLOWED[command]),
    };
}

// ---------------------------------------------------------------- pure policy

/** Sortable, unique id: UTC time, kind, random suffix. */
export function backupId(kind, now = new Date()) {
    if (!KINDS.includes(kind)) throw new Error('Unknown backup kind.');
    const stamp = now
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d+Z$/, 'Z');
    return `${stamp}-${kind}-${randomBytes(3).toString('hex')}`;
}

/** Free space needed: the estimate plus 10 %, plus a fixed reserve. */
export function requiredFreeBytes(
    estimateBytes,
    reserveMb = DEFAULT_RESERVE_MB,
) {
    return Math.ceil(estimateBytes * 1.1) + reserveMb * 1024 * 1024;
}

/**
 * Retention: verified backups older than RETENTION_DAYS go, except the
 * newest verified one, which is always kept, so pruning can never leave
 * the installation without a verified backup. Unverified entries are never
 * chosen here (stale incomplete directories are cleaned separately).
 */
export function selectForPruning(
    backups,
    now = new Date(),
    days = RETENTION_DAYS,
) {
    const verified = backups
        .filter((b) => b.verified)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const cutoff = now.getTime() - days * DAY_MS;
    return verified
        .slice(1)
        .filter((b) => Date.parse(b.createdAt) < cutoff)
        .map((b) => b.backupId)
        .sort();
}

/** Simple x.y.z comparison for the app compatibility check. */
export function compareVersions(a, b) {
    const pa = String(a).split(/[.+-]/).slice(0, 3).map(Number);
    const pb = String(b).split(/[.+-]/).slice(0, 3).map(Number);
    for (let i = 0; i < 3; i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return Math.sign(d);
    }
    return 0;
}

/**
 * A backup can be restored by a target only with the same MongoDB
 * major.minor (dump format and FCV) and an app version no older than the
 * one that wrote the data (an older app may not read newer data; newer app
 * versions migrate forward through #364).
 */
export function compatibility(manifest, target) {
    const problems = [];
    if (manifest.schema !== BACKUP_SCHEMA)
        problems.push(
            `backup format ${manifest.schema} is not ${BACKUP_SCHEMA}`,
        );
    const mm = (v) => String(v).split('.').slice(0, 2).join('.');
    if (mm(manifest.versions?.mongodb) !== mm(target.mongodb))
        problems.push(
            `backup is from MongoDB ${manifest.versions?.mongodb}, this installation runs ${target.mongodb}`,
        );
    if (compareVersions(manifest.versions?.app, target.app) > 0)
        problems.push(
            `backup is from app ${manifest.versions?.app}, newer than this installation's ${target.app}`,
        );
    return problems;
}

/** The status interface (#365): computed views over status.json. */
export function statusSummary(status, now = new Date()) {
    const age = (entry) =>
        entry?.at ? (now.getTime() - Date.parse(entry.at)) / DAY_MS : Infinity;
    return {
        ...status,
        backupOverdue: age(status.lastVerifiedSuccess) * 24 > OVERDUE_HOURS,
        exportReminderDue: age(status.lastExport) >= EXPORT_REMINDER_DAYS,
    };
}

export function emptyStatus() {
    return {
        schema: STATUS_SCHEMA,
        updatedAt: null,
        lastAttempt: null,
        lastSuccess: null,
        lastVerifiedSuccess: null,
        lastFailure: null,
        consecutiveFailures: 0,
        lastExport: null,
        lastRestore: null,
    };
}

// ---------------------------------------------------------------- fs helpers

const windows = process.platform === 'win32';

async function exists(path) {
    try {
        await stat(path);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

export async function writeAtomic(path, text, mode = 0o600) {
    const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temp, text, { flag: 'wx', mode });
    try {
        await rename(temp, path);
    } catch (error) {
        await rm(temp, { force: true });
        throw error;
    }
}

async function privateDir(path) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    if (!windows) await chmod(path, 0o700);
}

export async function sha256File(path) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex');
}

async function readJsonFile(path) {
    return JSON.parse(await readFile(path, 'utf8'));
}

// ---------------------------------------------------------------- status

export async function readStatus(paths) {
    try {
        const status = await readJsonFile(paths.backupStatus);
        if (status.schema !== STATUS_SCHEMA) throw new Error('schema');
        return { ...emptyStatus(), ...status };
    } catch (error) {
        if (error.code === 'ENOENT') return emptyStatus();
        throw new RefusedError(
            `Backup status file ${paths.backupStatus} is unreadable.`,
        );
    }
}

/**
 * An unreadable status file is never silently replaced: it is kept beside
 * as `status.corrupt-<time>.json`, and the new status starts with a
 * STATUS_CORRUPT failure naming it, so diagnostics show the lost history.
 */
async function updateStatus(paths, change) {
    let status;
    try {
        status = await readStatus(paths);
    } catch {
        const kept = join(
            paths.dirs.backups,
            `status.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
        );
        await rename(paths.backupStatus, kept);
        status = {
            ...emptyStatus(),
            lastFailure: {
                at: new Date().toISOString(),
                command: 'status',
                code: 'STATUS_CORRUPT',
                message: `The backup status file was unreadable; it was kept as ${kept}.`,
            },
            consecutiveFailures: 1,
        };
    }
    const next = {
        ...status,
        ...change(status),
        updatedAt: new Date().toISOString(),
    };
    await writeAtomic(paths.backupStatus, JSON.stringify(next, null, 2) + '\n');
    return next;
}

async function recordFailure(paths, command, error, backupId) {
    const code = error instanceof BackupError ? error.code : 'BACKUP_FAILED';
    const message =
        error instanceof BackupError || error instanceof RefusedError
            ? error.message
            : `${command} failed (${error.name ?? 'Error'}).`;
    await updateStatus(paths, (s) => ({
        lastFailure: {
            at: new Date().toISOString(),
            command,
            code,
            message,
            ...(backupId ? { backupId } : {}),
        },
        consecutiveFailures: s.consecutiveFailures + 1,
    })).catch(() => {});
}

// ---------------------------------------------------------------- mongo

export function mongoDriver(apiDir) {
    return createRequire(join(resolve(apiDir), 'package.json'))('mongoose')
        .mongo;
}

export function rootUri(password, port = PORTS.mongo) {
    if (!/^[A-Za-z0-9_-]+$/.test(password))
        throw new Error('Root password must be base64url text.');
    return `mongodb://${DB_USERS.root}:${password}@${LOOPBACK}:${port}/?authSource=admin&directConnection=true`;
}

export async function readRootPassword(paths) {
    const spec = SECRET_FILES.mongoRootPassword;
    const value = (
        await readFile(paths.secrets.mongoRootPassword, 'utf8')
    ).trim();
    if (!secretPattern(spec).test(value))
        throw new RefusedError(`Secret ${spec.file} is damaged.`);
    return value;
}

export async function connectRoot(driver, password) {
    const client = new driver.MongoClient(rootUri(password), {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
    });
    try {
        await client.connect();
        await client.db('admin').command({ ping: 1 });
        return client;
    } catch (error) {
        await client.close().catch(() => {});
        throw new BackupError(
            'DATABASE_UNAVAILABLE',
            "This installation's database is not running or does not accept its root credential. Start GroceryPOS-MongoDB and retry.",
            error.codeName,
        );
    }
}

/** The running database must be this installation's writable primary. */
export async function checkInstallationDatabase(root, install) {
    const admin = root.db('admin');
    const hello = await admin.command({ hello: 1 });
    if (hello.setName !== REPLICA_SET || hello.isWritablePrimary !== true)
        throw new BackupError(
            'DATABASE_UNAVAILABLE',
            'The database is not the writable primary of this installation.',
        );
    const marker = await root
        .db(RUNTIME_DATABASE)
        .collection('installation')
        .findOne({ _id: 'installation' });
    if (marker?.installationId !== install.installationId)
        throw new RefusedError('Database belongs to another installation.');
    const build = await admin.command({ buildInfo: 1 });
    const fcv = await admin.command({
        getParameter: 1,
        featureCompatibilityVersion: 1,
    });
    return {
        mongodb: build.version,
        fcv: fcv.featureCompatibilityVersion?.version,
    };
}

/** Runs a tool; captures output (scrubbed of `secrets`) for diagnostics. */
export function runTool(
    executable,
    args,
    { secrets = [], timeoutMs = 3600000 } = {},
) {
    return new Promise((done, fail) => {
        const child = spawn(executable, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let output = '';
        const keep = (d) => {
            output = (output + d).slice(-8000);
        };
        child.stdout.on('data', keep);
        child.stderr.on('data', keep);
        const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
        child.once('error', (error) => {
            clearTimeout(timer);
            fail(error);
        });
        child.once('exit', (code, signal) => {
            clearTimeout(timer);
            let text = output;
            for (const secret of secrets)
                if (secret) text = text.split(secret).join('<redacted>');
            text = text.replace(
                /mongodb(\+srv)?:\/\/[^@\s]*@/g,
                'mongodb://<redacted>@',
            );
            done({ code, signal, output: text });
        });
    });
}

export function toolPath(dir, name) {
    return join(dir, windows ? `${name}.exe` : name);
}

export async function toolVersion(tools) {
    const { code, output } = await runTool(toolPath(tools, 'mongodump'), [
        '--version',
    ]);
    const version = /mongodump version: (\S+)/.exec(output)?.[1];
    if (code !== 0 || !version)
        throw new BackupError(
            'TOOLS_UNAVAILABLE',
            'mongodump is not usable at --tools.',
        );
    return version;
}

export async function mongodVersion(mongod) {
    const { code, output } = await runTool(mongod, ['--version']);
    const version = /db version v(\S+)/.exec(output)?.[1];
    if (code !== 0 || !version)
        throw new BackupError(
            'TOOLS_UNAVAILABLE',
            'mongod is not usable at --mongod.',
        );
    return version;
}

export async function appVersion(apiDir) {
    return (await readJsonFile(join(resolve(apiDir), 'package.json'))).version;
}

function freePort() {
    return new Promise((done, fail) => {
        const server = createServer();
        server.once('error', fail);
        server.listen(0, LOOPBACK, () => {
            const { port } = server.address();
            server.close(() => done(port));
        });
    });
}

/** A private config file for a tool, so no credential is ever an argument. */
async function toolConfig(dir, uri) {
    const path = join(dir, `tool-${randomUUID()}.yaml`);
    await writeFile(path, `uri: ${JSON.stringify(uri)}\n`, {
        flag: 'wx',
        mode: 0o600,
    });
    return path;
}

// ---------------------------------------------------------------- content

async function listFiles(dir) {
    const out = [];
    async function walk(current) {
        for (const entry of await readdir(current, { withFileTypes: true })) {
            const full = join(current, entry.name);
            if (entry.isDirectory()) await walk(full);
            else out.push(full);
        }
    }
    await walk(dir);
    return out;
}

/**
 * Checks a backup directory: manifest checksum, every listed file's size
 * and SHA-256, no unlisted file, and (unless `verified: false` is allowed)
 * a passing test-restore record. Returns the manifest and verification.
 */
export async function checkBackup(dir, { requireVerified = true } = {}) {
    let manifestText;
    try {
        manifestText = await readFile(join(dir, MANIFEST), 'utf8');
    } catch {
        throw new BackupError(
            'BACKUP_CORRUPT',
            'The backup has no manifest; it is incomplete or not a backup.',
        );
    }
    const expected = (
        await readFile(join(dir, MANIFEST_SUM), 'utf8').catch(() => '')
    ).trim();
    if (createHash('sha256').update(manifestText).digest('hex') !== expected)
        throw new BackupError(
            'BACKUP_CORRUPT',
            'The backup manifest is damaged or incomplete.',
        );
    const manifest = JSON.parse(manifestText);
    if (
        manifest.schema !== BACKUP_SCHEMA ||
        !ID_PATTERN.test(manifest.backupId)
    )
        throw new BackupError(
            'BACKUP_INCOMPATIBLE',
            `Backup format ${manifest.schema} is not supported.`,
        );
    const listed = new Set(manifest.files.map((f) => f.path));
    for (const file of manifest.files) {
        const full = join(dir, ...file.path.split('/'));
        if (relative(dir, full).startsWith('..'))
            throw new BackupError(
                'BACKUP_CORRUPT',
                'The backup manifest is invalid.',
            );
        let info;
        try {
            info = await stat(full);
        } catch {
            throw new BackupError(
                'BACKUP_CORRUPT',
                `The backup is missing ${file.path}.`,
            );
        }
        if (info.size !== file.size || (await sha256File(full)) !== file.sha256)
            throw new BackupError(
                'BACKUP_CORRUPT',
                `The backup file ${file.path} is damaged.`,
            );
    }
    for (const full of await listFiles(dir)) {
        const rel = relative(dir, full).split(sep).join('/');
        if (
            ![MANIFEST, MANIFEST_SUM, VERIFICATION].includes(rel) &&
            !listed.has(rel)
        )
            throw new BackupError(
                'BACKUP_CORRUPT',
                `The backup holds an unexpected file ${rel}.`,
            );
    }
    let verification;
    try {
        verification = await readJsonFile(join(dir, VERIFICATION));
    } catch {
        verification = undefined;
    }
    const verified =
        verification?.ok === true &&
        verification.backupId === manifest.backupId &&
        verification.archiveSha256 ===
            manifest.files.find((f) => f.path === ARCHIVE)?.sha256;
    if (requireVerified && !verified)
        throw new BackupError(
            'BACKUP_UNVERIFIED',
            'The backup has not passed a test restore.',
        );
    return { manifest, verification: verified ? verification : undefined };
}

/**
 * Restores the archive into a throwaway standalone mongod on a free
 * loopback port and reads it back: the marker must match, every collection
 * must validate, and per-collection counts are recorded so a real restore
 * can be checked against them.
 */
export async function testRestore({
    dir,
    scratchParent,
    manifest,
    mongod,
    tools,
    driver,
}) {
    const scratch = join(
        scratchParent,
        `${SCRATCH}${manifest.backupId}-${randomUUID().slice(0, 8)}`,
    );
    await privateDir(scratch);
    const dbPath = join(scratch, 'db');
    await mkdir(dbPath);
    const port = await freePort();
    // Authenticated: the copy holds the whole store, so other local
    // accounts must not read it. The first user comes from the localhost
    // exception right after start-up; its random password lives only in
    // the owner-only scratch folder (for cleanup after a killed run, which
    // may leave this mongod behind) and in memory.
    const credential = randomBytes(32).toString('base64url');
    await writeFile(
        join(scratch, 'port'),
        JSON.stringify({ port, credential }),
        { mode: 0o600 },
    );
    const child = spawn(
        mongod,
        [
            '--auth',
            '--dbpath',
            dbPath,
            '--bind_ip',
            LOOPBACK,
            '--port',
            String(port),
            '--quiet',
            '--logpath',
            join(scratch, 'mongod.log'),
        ],
        { stdio: 'ignore', windowsHide: true },
    );
    let exited = false;
    child.once('exit', () => (exited = true));
    child.once('error', () => (exited = true));
    const anon = new driver.MongoClient(
        `mongodb://${LOOPBACK}:${port}/?directConnection=true`,
        { serverSelectionTimeoutMS: 2000 },
    );
    const uri = `mongodb://${VERIFY_USER}:${credential}@${LOOPBACK}:${port}/?authSource=admin&directConnection=true`;
    const client = new driver.MongoClient(uri, {
        serverSelectionTimeoutMS: 2000,
    });
    const config = join(scratch, 'tool.yaml');
    try {
        await boundedWait(
            async () => {
                if (exited)
                    throw new BackupError(
                        'VERIFY_FAILED',
                        'The test-restore mongod did not start.',
                    );
                try {
                    await anon.db('admin').command({ ping: 1 });
                    return true;
                } catch {
                    return false;
                }
            },
            { timeoutMs: 120000 },
        );
        await anon.db('admin').command({
            createUser: VERIFY_USER,
            pwd: credential,
            roles: ['root'],
        });
        await anon.close();
        await writeFile(config, `uri: ${JSON.stringify(uri)}\n`, {
            flag: 'wx',
            mode: 0o600,
        });
        const result = await runTool(
            toolPath(tools, 'mongorestore'),
            [
                `--config=${config}`,
                `--archive=${join(dir, ARCHIVE)}`,
                '--gzip',
                '--oplogReplay',
                '--stopOnError',
            ],
            { secrets: [credential] },
        );
        if (result.code !== 0)
            throw new BackupError(
                'VERIFY_FAILED',
                'The test restore of the backup failed.',
                result.output,
            );
        const marker = await client
            .db(RUNTIME_DATABASE)
            .collection('installation')
            .findOne({ _id: 'installation' });
        if (marker?.installationId !== manifest.installationId)
            throw new BackupError(
                'VERIFY_FAILED',
                "The backup does not hold this installation's marker.",
            );
        const collections = {};
        const db = client.db(APP_DATABASE);
        for (const { name, type } of await db.listCollections().toArray()) {
            if (type && type !== 'collection') continue;
            const valid = await db.command({ validate: name });
            if (!valid.valid)
                throw new BackupError(
                    'VERIFY_FAILED',
                    `Restored collection ${name} does not validate.`,
                );
            collections[name] = await db.collection(name).countDocuments({});
        }
        return {
            schema: BACKUP_SCHEMA,
            backupId: manifest.backupId,
            ok: true,
            method: 'test restore into a throwaway mongod (--oplogReplay) + validate',
            verifiedAt: new Date().toISOString(),
            archiveSha256: manifest.files.find((f) => f.path === ARCHIVE)
                .sha256,
            mongodb: await mongodVersion(mongod),
            collections,
        };
    } finally {
        try {
            await client.db('admin').command({ shutdown: 1, force: true });
        } catch {
            // shutdown drops the connection
        }
        await client.close().catch(() => {});
        await anon.close().catch(() => {});
        if (!exited) {
            const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
            await new Promise((r) => (exited ? r() : child.once('exit', r)));
            clearTimeout(timer);
        }
        await rm(scratch, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------- listing

/** Completed backup directories with their quick (manifest-only) state. */
export async function listBackups(paths) {
    const out = [];
    let entries = [];
    try {
        entries = await readdir(paths.dirs.backups, { withFileTypes: true });
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    for (const entry of entries) {
        if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue;
        const dir = join(paths.dirs.backups, entry.name);
        let manifest;
        let verified = false;
        try {
            const text = await readFile(join(dir, MANIFEST), 'utf8');
            const sum = (
                await readFile(join(dir, MANIFEST_SUM), 'utf8')
            ).trim();
            if (createHash('sha256').update(text).digest('hex') !== sum)
                throw new Error();
            manifest = JSON.parse(text);
            const v = await readJsonFile(join(dir, VERIFICATION));
            verified =
                v.ok === true &&
                v.backupId === entry.name &&
                v.archiveSha256 ===
                    manifest.files.find((f) => f.path === ARCHIVE)?.sha256;
        } catch {
            // listed as unverified
        }
        out.push({
            backupId: entry.name,
            dir,
            createdAt: manifest?.createdAt ?? null,
            kind: manifest?.kind ?? null,
            verified: verified && manifest?.backupId === entry.name,
        });
    }
    return out.sort((a, b) => a.backupId.localeCompare(b.backupId));
}

/**
 * Stops a test-restore mongod a killed run left behind, but only after it
 * proves (by its own reported dbPath) to be that scratch instance.
 */
async function stopOrphan(scratch, driver) {
    let port;
    let credential;
    try {
        ({ port, credential } = JSON.parse(
            await readFile(join(scratch, 'port'), 'utf8'),
        ));
    } catch {
        return;
    }
    if (!Number.isSafeInteger(port) || port <= 0) return;
    // With the run's credential; if it was killed before creating that
    // user, the localhost exception still answers anonymously.
    for (const auth of [
        { username: VERIFY_USER, password: credential },
        undefined,
    ]) {
        const client = new driver.MongoClient(
            `mongodb://${LOOPBACK}:${port}/?directConnection=true`,
            { serverSelectionTimeoutMS: 1000, auth, authSource: 'admin' },
        );
        try {
            const opts = await client
                .db('admin')
                .command({ getCmdLineOpts: 1 });
            if (
                resolve(opts.parsed?.storage?.dbPath ?? '') !==
                resolve(join(scratch, 'db'))
            )
                return;
            await client
                .db('admin')
                .command({ shutdown: 1, force: true })
                .catch(() => {});
            await boundedWait(
                async () => {
                    try {
                        await client.db('admin').command({ ping: 1 });
                        return false;
                    } catch {
                        return true;
                    }
                },
                { timeoutMs: 60000 },
            );
            return;
        } catch {
            // not answering with these credentials; try the next
        } finally {
            await client.close().catch(() => {});
        }
    }
}

/**
 * Removes leftovers of interrupted runs. Only call under the backup lock.
 * Test-restore scratch directories are only removed when a driver is at
 * hand to stop a leftover mongod first.
 */
async function cleanInterrupted(paths, log, driver) {
    let entries = [];
    try {
        entries = await readdir(paths.dirs.backups);
    } catch {
        return;
    }
    for (const name of entries) {
        const scratch = name.startsWith(SCRATCH);
        if (scratch && !driver) continue;
        if (scratch || name.startsWith(INCOMPLETE) || name.includes('.tmp-')) {
            if (scratch)
                await stopOrphan(join(paths.dirs.backups, name), driver);
            await rm(join(paths.dirs.backups, name), {
                recursive: true,
                force: true,
            });
            log(`cleanup: removed interrupted ${name}`);
        }
    }
}

// ---------------------------------------------------------------- lock

export async function withLock(paths, fn) {
    let token;
    try {
        token = await acquireLock(paths.backupLock);
    } catch (error) {
        if (error instanceof RefusedError)
            throw new RefusedError(
                'Another backup, export or restore is running.',
            );
        throw error;
    }
    try {
        return await fn();
    } finally {
        await releaseLock(paths.backupLock, token);
    }
}

export async function readInstall(paths) {
    try {
        const install = await readJsonFile(paths.install);
        if (typeof install.installationId !== 'string') throw new Error();
        return install;
    } catch {
        throw new RefusedError(
            `${paths.root} is not a Grocery POS installation.`,
        );
    }
}

// ---------------------------------------------------------------- create

/**
 * Creates a verified backup. Consistency: `mongodump --oplog` against the
 * replica-set primary copies every collection and the oplog written
 * meanwhile; `mongorestore --oplogReplay` replays it, so the restored data
 * is the single point in time at which the dump ended, including
 * multi-document transactions (applied whole from their oplog entry).
 * The result is only moved to its final name after a test restore passed.
 */
export async function createBackup(options, log = () => {}) {
    const paths = layout(resolve(options.dataRoot));
    const kind = options.kind ?? 'manual';
    const install = await readInstall(paths);
    const run = async () => {
        const id = backupId(kind);
        await updateStatus(paths, () => ({
            lastAttempt: {
                at: new Date().toISOString(),
                command: 'create',
                backupId: id,
            },
        }));
        try {
            const result = await createLocked(
                paths,
                install,
                { ...options, kind },
                id,
                log,
            );
            await updateStatus(paths, () => ({
                lastSuccess: {
                    at: result.completedAt,
                    command: 'create',
                    backupId: id,
                    kind,
                },
                lastVerifiedSuccess: {
                    at: result.verifiedAt,
                    backupId: id,
                    kind,
                    createdAt: result.createdAt,
                },
                consecutiveFailures: 0,
            }));
            // A pre-restore safety backup never prunes: the backup being
            // restored may be the oldest one (#363 review).
            const pruned = options.skipPrune
                ? []
                : await pruneLocked(paths, log);
            return { ...result, pruned };
        } catch (error) {
            await recordFailure(paths, 'create', error, id);
            throw error;
        }
    };
    return options.lockHeld ? run() : withLock(paths, run);
}

async function createLocked(paths, install, options, id, log) {
    const backups = paths.dirs.backups;
    try {
        await privateDir(backups);
        await writeFile(join(backups, `.probe.tmp-${process.pid}`), '');
        await rm(join(backups, `.probe.tmp-${process.pid}`));
    } catch {
        throw new BackupError(
            'DESTINATION_UNAVAILABLE',
            `The backup folder ${backups} cannot be written.`,
        );
    }
    const driver = mongoDriver(options.api);
    await cleanInterrupted(paths, log, driver);
    const password = await readRootPassword(paths);
    const tools = await toolVersion(options.tools);
    const app = await appVersion(options.api);
    const root = await connectRoot(driver, password);
    let versions;
    let estimate = 0;
    try {
        versions = await checkInstallationDatabase(root, install);
        for (const db of [APP_DATABASE, RUNTIME_DATABASE]) {
            const s = await root.db(db).command({ dbStats: 1 });
            estimate += (s.dataSize ?? 0) + (s.indexSize ?? 0);
        }
    } finally {
        await root.close();
    }
    const { bavail, bsize } = await statfs(backups);
    const free = Number(bavail) * Number(bsize);
    const needed = requiredFreeBytes(estimate, options.reserveMb);
    if (free < needed)
        throw new BackupError(
            'LOW_DISK',
            `Not enough free disk for a backup: ${Math.round(free / 1048576)} MB free, ${Math.round(needed / 1048576)} MB needed.`,
        );

    const createdAt = new Date().toISOString();
    const work = join(backups, `${INCOMPLETE}${id}`);
    await privateDir(work);
    try {
        return await dumpAndVerify(
            paths,
            install,
            options,
            { id, work, createdAt, password, driver, versions, tools, app },
            log,
        );
    } catch (error) {
        // Never leave partial output that could be mistaken for a backup.
        await rm(work, { recursive: true, force: true }).catch(() => {});
        throw error;
    }
}

async function dumpAndVerify(
    paths,
    install,
    options,
    { id, work, createdAt, password, driver, versions, tools, app },
    log,
) {
    const backups = paths.dirs.backups;
    log(`backup ${id}: dumping the database (mongodump --oplog)`);
    const config = await toolConfig(work, rootUri(password));
    let dump;
    try {
        dump = await runTool(
            toolPath(options.tools, 'mongodump'),
            [
                `--config=${config}`,
                '--oplog',
                '--gzip',
                `--archive=${join(work, ARCHIVE)}`,
                '--quiet',
            ],
            { secrets: [password] },
        );
    } finally {
        await rm(config, { force: true });
    }
    if (dump.code !== 0)
        throw new BackupError(
            'DUMP_FAILED',
            'mongodump failed; no backup was recorded.',
            dump.output,
        );
    if (!windows) await chmod(join(work, ARCHIVE), 0o600);

    for (const rel of INCLUDED_FILES) {
        const target = join(work, 'files', ...rel.split('/'));
        await privateDir(dirname(target));
        await copyFile(join(paths.root, ...rel.split('/')), target);
        if (!windows) await chmod(target, 0o600);
    }
    const files = [];
    for (const full of (await listFiles(work)).sort()) {
        const info = await stat(full);
        files.push({
            path: relative(work, full).split(sep).join('/'),
            size: info.size,
            sha256: await sha256File(full),
        });
    }
    const manifest = {
        schema: BACKUP_SCHEMA,
        backupId: id,
        kind: options.kind,
        installationId: install.installationId,
        createdAt,
        completedAt: new Date().toISOString(),
        snapshot: {
            method: 'mongodump --oplog --gzip --archive (replica-set point in time)',
            restore: 'mongorestore --oplogReplay',
            databases: ARCHIVE_DATABASES,
        },
        versions: { mongodb: versions.mongodb, fcv: versions.fcv, tools, app },
        contents: {
            included: [ARCHIVE, ...INCLUDED_FILES.map((p) => `files/${p}`)],
            excluded: EXCLUDED,
            plaintext:
                'Secrets are stored unencrypted (owner decision); whoever holds this backup can read the store data and its secrets.',
        },
        files,
    };
    const manifestText = JSON.stringify(manifest, null, 2) + '\n';
    await writeFile(join(work, MANIFEST), manifestText, { mode: 0o600 });
    await writeFile(
        join(work, MANIFEST_SUM),
        createHash('sha256').update(manifestText).digest('hex') + '\n',
        { mode: 0o600 },
    );
    log(`backup ${id}: verifying (checksums and test restore)`);
    await checkBackup(work, { requireVerified: false });
    const verification = await testRestore({
        dir: work,
        scratchParent: backups,
        manifest,
        mongod: options.mongod,
        tools: options.tools,
        driver,
    });
    await writeFile(
        join(work, VERIFICATION),
        JSON.stringify(verification, null, 2) + '\n',
        {
            mode: 0o600,
        },
    );
    await rename(work, join(backups, id));
    log(`backup ${id}: verified`);
    return {
        backupId: id,
        dir: join(backups, id),
        createdAt,
        completedAt: manifest.completedAt,
        verifiedAt: verification.verifiedAt,
        collections: verification.collections,
    };
}

// ---------------------------------------------------------------- verify

/** Re-verifies a stored or exported backup (checksums + test restore). */
export async function verifyBackup(options, log = () => {}) {
    const paths = layout(resolve(options.dataRoot));
    return withLock(paths, async () => {
        const dir =
            options.from ??
            join(
                paths.dirs.backups,
                options.backup ?? (await latestVerified(paths)).backupId,
            );
        try {
            const { manifest } = await checkBackup(dir, {
                requireVerified: false,
            });
            log(`verify ${manifest.backupId}: checksums match; test restore`);
            const verification = await testRestore({
                dir,
                scratchParent: options.from
                    ? paths.dirs.backups
                    : paths.dirs.backups,
                manifest,
                mongod: options.mongod,
                tools: options.tools,
                driver: mongoDriver(options.api),
            });
            const inStore =
                resolve(dirname(dir)) === resolve(paths.dirs.backups);
            if (inStore) {
                await writeAtomic(
                    join(dir, VERIFICATION),
                    JSON.stringify(verification, null, 2) + '\n',
                );
                await updateStatus(paths, () => ({
                    lastVerifiedSuccess: {
                        at: verification.verifiedAt,
                        backupId: manifest.backupId,
                        kind: manifest.kind,
                        createdAt: manifest.createdAt,
                    },
                }));
            }
            return {
                backupId: manifest.backupId,
                verifiedAt: verification.verifiedAt,
                collections: verification.collections,
            };
        } catch (error) {
            await recordFailure(paths, 'verify', error);
            throw error;
        }
    });
}

async function latestVerified(paths) {
    const verified = (await listBackups(paths)).filter((b) => b.verified);
    if (!verified.length)
        throw new BackupError(
            'NO_VERIFIED_BACKUP',
            'There is no verified backup.',
        );
    return verified.at(-1);
}

// ---------------------------------------------------------------- prune

async function pruneLocked(paths, log) {
    await cleanInterrupted(paths, log);
    const remove = selectForPruning(await listBackups(paths));
    for (const id of remove) {
        await rm(join(paths.dirs.backups, id), {
            recursive: true,
            force: true,
        });
        log(`retention: removed ${id}`);
    }
    return remove;
}

export async function prune(options, log = () => {}) {
    const paths = layout(resolve(options.dataRoot));
    await readInstall(paths);
    return withLock(paths, () => pruneLocked(paths, log));
}

// ---------------------------------------------------------------- export

/**
 * Copies a verified backup to another disk (owner decision: plaintext, no
 * recovery password). Refuses the data root's own disk unless explicitly
 * allowed; verifies every checksum at the destination before naming it.
 */
export async function exportBackup(options, log = () => {}) {
    const paths = layout(resolve(options.dataRoot));
    await readInstall(paths);
    return withLock(paths, async () => {
        await updateStatus(paths, () => ({
            lastAttempt: { at: new Date().toISOString(), command: 'export' },
        }));
        try {
            const source = options.backup
                ? join(paths.dirs.backups, options.backup)
                : (await latestVerified(paths)).dir;
            const { manifest } = await checkBackup(source);
            let destInfo;
            try {
                destInfo = await stat(options.to);
                if (!destInfo.isDirectory()) throw new Error();
            } catch {
                throw new BackupError(
                    'DESTINATION_UNAVAILABLE',
                    `Export destination ${options.to} is not available. Connect the drive and retry.`,
                );
            }
            if (!options.testAllowFixedDestination) {
                if (destInfo.dev === (await stat(paths.root)).dev)
                    throw new BackupError(
                        'DESTINATION_SAME_DISK',
                        'The export destination is on the same disk as the installation; use a removable drive.',
                    );
                const media = await destinationMedia(options.to, paths.root);
                if (!media.removable)
                    throw new BackupError(
                        media.reason === 'unknown'
                            ? 'DESTINATION_UNKNOWN_MEDIA'
                            : 'DESTINATION_NOT_REMOVABLE',
                        media.reason === 'unknown'
                            ? 'The export destination could not be identified as a removable drive.'
                            : 'Exports go to a removable drive (USB or memory card) only; this destination is a fixed or system disk.',
                    );
            }
            const size = manifest.files.reduce((n, f) => n + f.size, 0);
            const { bavail, bsize } = await statfs(options.to);
            if (Number(bavail) * Number(bsize) < requiredFreeBytes(size, 0))
                throw new BackupError(
                    'LOW_DISK',
                    'Not enough free space on the export destination.',
                );
            const name = `${EXPORT_PREFIX}${manifest.backupId}`;
            const final = join(options.to, name);
            if (await exists(final)) {
                await checkBackup(final);
                log(`export ${manifest.backupId}: already present and intact`);
            } else {
                const work = join(
                    options.to,
                    `${INCOMPLETE}${name}-${randomUUID().slice(0, 8)}`,
                );
                try {
                    for (const rel of [
                        ...manifest.files.map((f) => f.path),
                        MANIFEST,
                        MANIFEST_SUM,
                        VERIFICATION,
                    ]) {
                        const target = join(work, ...rel.split('/'));
                        await mkdir(dirname(target), { recursive: true });
                        await copyFile(join(source, ...rel.split('/')), target);
                    }
                    await checkBackup(work);
                    await rename(work, final);
                } catch (error) {
                    await rm(work, { recursive: true, force: true });
                    if (error instanceof BackupError) throw error;
                    throw new BackupError(
                        'EXPORT_FAILED',
                        'Copying the backup to the destination failed.',
                        error.code,
                    );
                }
            }
            const at = new Date().toISOString();
            await updateStatus(paths, () => ({
                lastSuccess: {
                    at,
                    command: 'export',
                    backupId: manifest.backupId,
                },
                lastExport: {
                    at,
                    backupId: manifest.backupId,
                    destination: final,
                },
                consecutiveFailures: 0,
            }));
            log(`export ${manifest.backupId}: copied and checked at ${final}`);
            return { backupId: manifest.backupId, destination: final };
        } catch (error) {
            await recordFailure(paths, 'export', error);
            throw error;
        }
    });
}

// ---------------------------------------------------------------- status

export async function backupStatus(options) {
    const paths = layout(resolve(options.dataRoot));
    await readInstall(paths);
    const summary = statusSummary(await readStatus(paths));
    const backups = await listBackups(paths);
    return {
        ...summary,
        backups: backups.map(({ backupId, kind, createdAt, verified }) => ({
            backupId,
            kind,
            createdAt,
            verified,
        })),
    };
}

// ---------------------------------------------------------------- cli

export function report(error) {
    if (error instanceof RefusedError) {
        process.stderr.write(`Refused: ${error.message}\n`);
        return EXIT.REFUSED;
    }
    if (error instanceof BackupError) {
        process.stderr.write(`Failed [${error.code}]: ${error.message}\n`);
        if (error.detail && process.env.GPOS_BACKUP_DEBUG === '1')
            process.stderr.write(`${error.detail}\n`);
        return EXIT.FAILED;
    }
    // Fixed text: a driver/OS message may quote a connection string.
    process.stderr.write(
        `Failed (${error.name ?? 'Error'}); see the command's documentation.\n`,
    );
    return EXIT.FAILED;
}

async function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return EXIT.USAGE;
    }
    const log = (line) => process.stdout.write(`${line}\n`);
    const commands = {
        create: () => createBackup(options, log),
        verify: () => verifyBackup(options, log),
        export: () => exportBackup(options, log),
        prune: () => prune(options, log),
        status: () => backupStatus(options),
    };
    try {
        const result = await commands[options.command]();
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return EXIT.OK;
    } catch (error) {
        return report(error);
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    process.exit(await main());
}
