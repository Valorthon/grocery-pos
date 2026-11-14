// Single-PC runtime provisioning (#360). Idempotent: a repeat run on a
// complete installation verifies it and rewrites only derived files; an
// interrupted run resumes; a foreign, incompatible or damaged state is
// refused unchanged (never reset). Prints progress, never secrets.
//
//   node provision.mjs --data-root <abs dir> --mongod <mongod> --api <api dir>
//       [--cache-size-gb <n>] [--store-timezone <IANA>]
//
// Exit codes: 0 ready, 1 failure, 2 usage, 3 refused (nothing reset).
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { connect as netConnect } from 'node:net';
import {
    chmod,
    link,
    mkdir,
    readdir,
    readFile,
    rename,
    rm,
    stat,
    unlink,
    writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedWait } from '../proof/policy.mjs';
import {
    APP_DATABASE,
    DB_USERS,
    DIRECTORIES,
    LOOPBACK,
    PORTS,
    REPLICA_SET,
    RUNTIME_DATABASE,
    RUNTIME_SCHEMA,
    SECRET_FILES,
    apiEnv,
    layout,
    mongodConfig,
    runtimeManifest,
    secretPattern,
} from './layout.mjs';

export const EXIT = { OK: 0, FAILED: 1, USAGE: 2, REFUSED: 3 };
const STAGES = ['layout', 'secrets', 'database', 'config'];
const MONGO_FCV = '7.0';

/** A safe refusal: the installation is left exactly as found. */
export class RefusedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RefusedError';
    }
}

export function parseArgs(args) {
    const known = {
        'data-root': 'dataRoot',
        mongod: 'mongod',
        api: 'api',
        'cache-size-gb': 'cacheSizeGB',
        'store-timezone': 'storeTimezone',
    };
    const out = {};
    for (let i = 0; i < args.length; i += 2) {
        const name = args[i]?.startsWith('--') ? args[i].slice(2) : undefined;
        const value = args[i + 1];
        if (
            !name ||
            !Object.hasOwn(known, name) ||
            value === undefined ||
            value.startsWith('--') ||
            Object.hasOwn(out, known[name])
        ) {
            throw new Error('Expected each documented option at most once.');
        }
        out[known[name]] = value;
    }
    for (const required of ['dataRoot', 'mongod', 'api']) {
        if (!out[required]) throw new Error(`--${required} is required.`);
    }
    if (!isAbsolute(out.dataRoot)) {
        throw new Error('--data-root must be an absolute path.');
    }
    if (out.cacheSizeGB !== undefined) {
        const gb = Number(out.cacheSizeGB);
        if (!Number.isFinite(gb) || gb < 0.25 || gb > 64) {
            throw new Error('--cache-size-gb must be between 0.25 and 64.');
        }
        out.cacheSizeGB = gb;
    }
    if (out.storeTimezone !== undefined) {
        try {
            new Intl.DateTimeFormat('en', { timeZone: out.storeTimezone });
        } catch {
            throw new Error('--store-timezone must be an IANA timezone.');
        }
    }
    return out;
}

const windows = process.platform === 'win32';

/** Owner-only on POSIX. On Windows: SYSTEM and Administrators only; #362
 *  adds each service identity's grant (README.md "Permissions"). */
async function restrict(path, mode) {
    if (!windows) {
        await chmod(path, mode);
        return;
    }
    execFileSync(
        'icacls',
        [
            path,
            '/inheritance:r',
            '/grant:r',
            '*S-1-5-18:(OI)(CI)F',
            '*S-1-5-32-544:(OI)(CI)F',
        ],
        { stdio: 'ignore', windowsHide: true, timeout: 30000 },
    );
}

async function exists(path) {
    try {
        await stat(path);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

async function readJson(path) {
    try {
        return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw new RefusedError(`Unreadable runtime state file ${path}.`);
    }
}

/** Write-then-rename, so a crash leaves the old or the new file. */
async function writeAtomic(path, text, mode) {
    const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temp, text, { flag: 'wx', mode });
    try {
        await rename(temp, path);
    } catch (error) {
        await rm(temp, { force: true });
        throw error;
    }
}

/** Write once: link() refuses an existing name, so a secret is never replaced. */
async function writeOnce(path, text) {
    const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temp, text, { flag: 'wx', mode: 0o600 });
    try {
        await link(temp, path);
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    } finally {
        await unlink(temp);
    }
}

/** Fresh: absent, or only our (empty) layout directories from an earlier
 *  attempt that stopped before install.json existed. */
async function isFreshRoot(root) {
    if (!(await exists(root))) return true;
    for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !Object.hasOwn(DIRECTORIES, entry.name))
            return false;
        const inner = await readdir(join(root, entry.name));
        if (inner.some((name) => !name.includes('.tmp-'))) return false;
    }
    return true;
}

function pidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === 'EPERM';
    }
}

async function acquireLock(path) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await writeFile(path, String(process.pid), { flag: 'wx' });
            return;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
        const pid = Number(await readFile(path, 'utf8').catch(() => 'NaN'));
        if (Number.isSafeInteger(pid) && pid > 0 && pidAlive(pid)) {
            throw new RefusedError('Another provisioning run is active.');
        }
        await rm(path, { force: true }); // left by an interrupted run
    }
    throw new RefusedError('Could not take the provisioning lock.');
}

function portInUse(port) {
    return new Promise((done) => {
        const socket = netConnect({ host: LOOPBACK, port });
        socket.setTimeout(1000);
        socket.once('connect', () => {
            socket.destroy();
            done(true);
        });
        socket.once('timeout', () => {
            socket.destroy();
            done(true);
        });
        socket.once('error', () => done(false));
    });
}

async function readSecrets(paths, { create }) {
    const values = {};
    for (const [key, spec] of Object.entries(SECRET_FILES)) {
        const path = paths.secrets[key];
        if (!(await exists(path))) {
            if (!create) {
                throw new RefusedError(
                    `Secret ${spec.file} is missing from an initialized installation; restore it from a backup.`,
                );
            }
            await writeOnce(
                path,
                randomBytes(spec.bytes).toString(spec.encoding),
            );
        }
        if (!windows) await chmod(path, 0o600);
        const value = (await readFile(path, 'utf8')).trim();
        if (!secretPattern(spec).test(value)) {
            throw new RefusedError(`Secret ${spec.file} is damaged.`);
        }
        values[key] = value;
    }
    return values;
}

function mongoDriver(apiDir) {
    const fromApi = createRequire(join(resolve(apiDir), 'package.json'));
    return fromApi('mongoose').mongo;
}

function client(driver, auth) {
    return new driver.MongoClient(
        `mongodb://${LOOPBACK}:${PORTS.mongo}/?directConnection=true`,
        {
            auth,
            authSource: 'admin',
            serverSelectionTimeoutMS: 2000,
            connectTimeoutMS: 2000,
            socketTimeoutMS: 10000,
        },
    );
}

async function tryRootClient(driver, password) {
    const root = client(driver, { username: DB_USERS.root, password });
    try {
        await root.connect();
        await root.db('admin').command({ ping: 1 });
        return root;
    } catch (error) {
        await root.close().catch(() => {});
        if (error.code === 18 || error.codeName === 'AuthenticationFailed')
            return undefined;
        throw error;
    }
}

async function startMongod(mongodPath, paths, log) {
    if (await portInUse(PORTS.mongo)) return undefined;
    log('database: starting mongod for provisioning');
    const child = spawn(mongodPath, ['--config', paths.mongodConfig], {
        stdio: 'ignore',
        windowsHide: true,
    });
    // For the operator if this run is killed: the child may outlive it.
    if (child.pid) await writeAtomic(paths.mongodPid, String(child.pid), 0o600);
    let exited = false;
    child.once('exit', () => {
        exited = true;
        rm(paths.mongodPid, { force: true }).catch(() => {});
    });
    child.once('error', () => (exited = true));
    await boundedWait(
        async () => {
            if (exited) throw new Error('mongod exited during startup.');
            return portInUse(PORTS.mongo);
        },
        { timeoutMs: 120000 },
    );
    return child;
}

async function stopMongod(child, rootClient) {
    if (!child) return;
    const exited = new Promise((done) => {
        if (child.exitCode !== null) done();
        child.once('exit', done);
    });
    try {
        await rootClient?.db('admin').command({ shutdown: 1 });
    } catch {
        // The shutdown command drops the connection; that is expected.
    }
    if (!rootClient) child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    await exited;
    clearTimeout(timer);
}

async function provisionDatabase(
    driver,
    paths,
    secrets,
    install,
    journal,
    log,
) {
    let root = await tryRootClient(driver, secrets.mongoRootPassword);
    if (!root) {
        // No root yet: only the localhost exception (no users at all) lets
        // us continue. Anything else is a database we cannot prove is ours.
        const anon = client(driver);
        try {
            await anon.connect();
            const hello = await anon.db('admin').command({ hello: 1 });
            if (hello.setName && hello.setName !== REPLICA_SET) {
                throw new RefusedError(
                    'Database belongs to another replica set.',
                );
            }
            if (!hello.setName) {
                log('database: initiating single-node replica set');
                await anon.db('admin').command({
                    replSetInitiate: {
                        _id: REPLICA_SET,
                        members: [
                            { _id: 0, host: `${LOOPBACK}:${PORTS.mongo}` },
                        ],
                    },
                });
            }
            await boundedWait(
                async () =>
                    (await anon.db('admin').command({ hello: 1 }))
                        .isWritablePrimary === true,
                { timeoutMs: 120000 },
            );
            log('database: creating the root user');
            try {
                await anon.db('admin').command({
                    createUser: DB_USERS.root,
                    pwd: secrets.mongoRootPassword,
                    roles: ['root'],
                });
            } catch (error) {
                if (error.code === 13 || error.codeName === 'Unauthorized') {
                    throw new RefusedError(
                        'Database has users whose credentials this installation does not hold.',
                    );
                }
                throw error;
            }
        } finally {
            await anon.close();
        }
        root = await tryRootClient(driver, secrets.mongoRootPassword);
        if (!root) throw new Error('Root user could not authenticate.');
    }
    try {
        await verifyAndConverge(root, install, journal, secrets, log);
        return root;
    } catch (error) {
        // The caller stops a mongod it started; it needs root to do so.
        error.rootClient = root;
        throw error;
    }
}

async function verifyAndConverge(root, install, journal, secrets, log) {
    const admin = root.db('admin');
    await boundedWait(
        async () =>
            (await admin.command({ hello: 1 })).isWritablePrimary === true,
        { timeoutMs: 120000 },
    );
    const hello = await admin.command({ hello: 1 });
    if (
        hello.setName !== REPLICA_SET ||
        hello.hosts?.length !== 1 ||
        hello.hosts[0] !== `${LOOPBACK}:${PORTS.mongo}`
    ) {
        throw new RefusedError(
            'Replica-set configuration is not this runtime.',
        );
    }
    const fcv = await admin.command({
        getParameter: 1,
        featureCompatibilityVersion: 1,
    });
    if (fcv.featureCompatibilityVersion?.version !== MONGO_FCV) {
        throw new RefusedError(
            `Database feature compatibility is not ${MONGO_FCV}; upgrade is #364's.`,
        );
    }
    const markers = root.db(RUNTIME_DATABASE).collection('installation');
    const marker = await markers.findOne({ _id: 'installation' });
    if (marker && marker.installationId !== install.installationId) {
        throw new RefusedError('Database belongs to another installation.');
    }
    if (!marker) {
        if (journal.stages.database) {
            throw new RefusedError('Installation marker is missing.');
        }
        await markers.insertOne({
            _id: 'installation',
            installationId: install.installationId,
            schema: RUNTIME_SCHEMA,
            createdAt: new Date(),
        });
    }
    // Converge the API user to the stored password and least role.
    const api = {
        pwd: secrets.mongoApiPassword,
        roles: [{ role: 'readWrite', db: APP_DATABASE }],
    };
    const users = await admin.command({ usersInfo: DB_USERS.api });
    if (users.users.length === 0) {
        log('database: creating the API user');
        await admin.command({ createUser: DB_USERS.api, ...api });
    } else {
        await admin.command({ updateUser: DB_USERS.api, ...api });
    }
}

/** Runs every stage; returns a summary without secrets. */
export async function provision(options, log = () => {}) {
    const paths = layout(resolve(options.dataRoot));
    let install;
    if (await isFreshRoot(paths.root)) {
        await mkdir(paths.dirs.state, { recursive: true, mode: 0o700 });
        await restrict(paths.root, 0o700);
        install = {
            schema: RUNTIME_SCHEMA,
            installationId: randomUUID(),
            createdAt: new Date().toISOString(),
        };
        await writeAtomic(
            paths.install,
            JSON.stringify(install, null, 2) + '\n',
            0o600,
        );
        log('layout: new installation');
    } else {
        install = await readJson(paths.install);
        if (!install) {
            throw new RefusedError(
                'Data root is not empty and is not a Grocery POS installation.',
            );
        }
        if (install.schema !== RUNTIME_SCHEMA) {
            throw new RefusedError(
                `Installation schema ${install.schema} is not ${RUNTIME_SCHEMA}.`,
            );
        }
    }
    await acquireLock(paths.lock);
    let child;
    let root;
    try {
        const journal = (await readJson(paths.journal)) ?? { stages: {} };
        const done = async (stage) => {
            journal.stages[stage] ??= new Date().toISOString();
            await writeAtomic(
                paths.journal,
                JSON.stringify(journal, null, 2) + '\n',
                0o600,
            );
            log(`${stage}: done`);
        };
        for (const [name, { private: isPrivate }] of Object.entries(
            DIRECTORIES,
        )) {
            await mkdir(paths.dirs[name], { recursive: true });
            await restrict(paths.dirs[name], isPrivate ? 0o700 : 0o750);
        }
        for (const dir of [
            paths.apiLogs,
            paths.proxyLogs,
            paths.caddyData,
            paths.caddyConfig,
        ])
            await mkdir(dir, { recursive: true });
        await done('layout');

        const secrets = await readSecrets(paths, {
            create: !journal.stages.secrets,
        });
        await done('secrets');

        await writeAtomic(
            paths.mongodConfig,
            JSON.stringify(
                mongodConfig(paths, { cacheSizeGB: options.cacheSizeGB }),
                null,
                2,
            ) + '\n',
            0o640,
        );
        const driver = mongoDriver(options.api);
        child = await startMongod(options.mongod, paths, log);
        if (!child) {
            // Something already listens on the port. Continue only if it
            // proves to be this installation's database (e.g. its service
            // or an earlier interrupted run's child); never stop it.
            const probe = await tryRootClient(
                driver,
                secrets.mongoRootPassword,
            ).catch(() => undefined);
            const ours = probe
                ? await probe
                      .db(RUNTIME_DATABASE)
                      .collection('installation')
                      .findOne({ _id: 'installation' })
                : undefined;
            await probe?.close();
            if (ours?.installationId !== install.installationId) {
                throw new RefusedError(
                    `Port ${PORTS.mongo} is in use by something that is not provably this installation's database. ` +
                        `If an interrupted run left its mongod (process id in ${paths.mongodPid}), stop that process and re-run.`,
                );
            }
            log("database: using this installation's running database");
        }
        try {
            root = await provisionDatabase(
                driver,
                paths,
                secrets,
                install,
                journal,
                log,
            );
        } catch (error) {
            root = error.rootClient;
            throw error;
        }
        await done('database');

        await writeAtomic(
            paths.apiEnv,
            apiEnv(paths, secrets, { storeTimezone: options.storeTimezone }),
            0o600,
        );
        await writeAtomic(
            paths.runtimeManifest,
            JSON.stringify(runtimeManifest(paths, install), null, 2) + '\n',
            0o640,
        );
        await done('config');
        journal.complete = STAGES.every((stage) => journal.stages[stage]);
        await writeAtomic(
            paths.journal,
            JSON.stringify(journal, null, 2) + '\n',
            0o600,
        );
        return {
            installationId: install.installationId,
            dataRoot: paths.root,
            complete: journal.complete,
        };
    } finally {
        await stopMongod(child, root);
        await root?.close().catch(() => {});
        await rm(paths.lock, { force: true });
    }
}

async function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return EXIT.USAGE;
    }
    try {
        const summary = await provision(options, (line) =>
            process.stdout.write(`${line}\n`),
        );
        process.stdout.write(`${JSON.stringify(summary)}\n`);
        return EXIT.OK;
    } catch (error) {
        if (error instanceof RefusedError) {
            process.stderr.write(`Refused: ${error.message}\n`);
            return EXIT.REFUSED;
        }
        // Fixed text: a driver/OS message may quote a connection string.
        process.stderr.write(
            `Provisioning failed (${error.name ?? 'Error'}); nothing was reset. Re-run to resume.\n`,
        );
        return EXIT.FAILED;
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    // Bounded: a leaked handle never keeps the installer waiting.
    process.exit(await main());
}
