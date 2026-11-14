// Single-PC runtime interface (#360): persistent layout, ports, generated
// configuration and service definitions. Pure functions only, so the
// installer (#362), backup (#363), upgrade (#364) and diagnostics (#365)
// share one definition and portable tests can pin it. See README.md.
import { join } from 'node:path';

export const RUNTIME_SCHEMA = 1;

/** Fixed loopback ports (ARCHITECTURE.md "Local access interface"). */
export const PORTS = Object.freeze({ proxy: 1443, api: 13000, mongo: 27018 });
export const ORIGIN = `https://localhost:${PORTS.proxy}`;
export const LOOPBACK = '127.0.0.1';

export const REPLICA_SET = 'gpos';
export const APP_DATABASE = 'grocery';
/** Installation marker; never an application collection. */
export const RUNTIME_DATABASE = 'gpos_runtime';
export const DB_USERS = Object.freeze({ root: 'gpos_root', api: 'gpos_api' });

export const SERVICES = Object.freeze({
    mongo: 'GroceryPOS-MongoDB',
    api: 'GroceryPOS-API',
    proxy: 'GroceryPOS-Proxy',
});

/**
 * Persistent directories under the data root
 * (%ProgramData%\Valorthon\GroceryPOS on Windows). `private` ones are
 * owner-only on POSIX; on Windows the installer narrows them per service
 * identity (README.md "Permissions").
 */
export const DIRECTORIES = Object.freeze({
    config: { private: false },
    secrets: { private: true },
    database: { private: true },
    tls: { private: true },
    logs: { private: false },
    backups: { private: true },
    state: { private: true },
});

/** Generated once, never rewritten. Values are base64/base64url text. */
export const SECRET_FILES = Object.freeze({
    mongoKeyfile: { file: 'mongo-keyfile', bytes: 756, encoding: 'base64' },
    mongoRootPassword: {
        file: 'mongo-root-password',
        bytes: 48,
        encoding: 'base64url',
    },
    mongoApiPassword: {
        file: 'mongo-api-password',
        bytes: 48,
        encoding: 'base64url',
    },
    jwtSecret: { file: 'jwt-secret', bytes: 48, encoding: 'base64url' },
    cookieSecret: { file: 'cookie-secret', bytes: 48, encoding: 'base64url' },
});

export function secretPattern({ bytes, encoding }) {
    const length = Math.ceil((bytes * 4) / 3);
    return encoding === 'base64'
        ? new RegExp(`^[A-Za-z0-9+/]{${length}}={0,2}$`)
        : new RegExp(`^[A-Za-z0-9_-]{${length}}$`);
}

/** Every path the runtime uses, from one absolute data root. */
export function layout(root) {
    const dirs = Object.fromEntries(
        Object.keys(DIRECTORIES).map((name) => [name, join(root, name)]),
    );
    return {
        root,
        dirs,
        secrets: Object.fromEntries(
            Object.entries(SECRET_FILES).map(([key, { file }]) => [
                key,
                join(dirs.secrets, file),
            ]),
        ),
        apiEnv: join(dirs.secrets, 'api.env'),
        mongodConfig: join(dirs.config, 'mongod.cfg'),
        runtimeManifest: join(dirs.config, 'runtime.json'),
        install: join(dirs.state, 'install.json'),
        journal: join(dirs.state, 'provision.json'),
        lock: join(dirs.state, 'provision.lock'),
        mongodPid: join(dirs.state, 'mongod.pid'),
        mongodLog: join(dirs.logs, 'mongod.log'),
        apiLogs: join(dirs.logs, 'api'),
        proxyLogs: join(dirs.logs, 'proxy'),
        caddyData: join(dirs.tls, 'data'),
        caddyConfig: join(dirs.tls, 'config'),
    };
}

/**
 * mongod configuration (JSON is valid YAML). Authenticated single-node
 * replica set on loopback only. `cacheSizeGB` is left to MongoDB unless
 * the operator sets one (4 GB qualification is #357's).
 */
export function mongodConfig(paths, { cacheSizeGB } = {}) {
    return {
        storage: {
            dbPath: paths.dirs.database,
            ...(cacheSizeGB === undefined
                ? {}
                : { wiredTiger: { engineConfig: { cacheSizeGB } } }),
        },
        systemLog: {
            destination: 'file',
            path: paths.mongodLog,
            logAppend: true,
            logRotate: 'rename',
        },
        net: { bindIp: LOOPBACK, port: PORTS.mongo, ipv6: false },
        replication: { replSetName: REPLICA_SET },
        security: {
            authorization: 'enabled',
            keyFile: paths.secrets.mongoKeyfile,
        },
    };
}

/** DB URL for a given user; the password is base64url (URI-safe). */
export function databaseUrl(user, password, database = APP_DATABASE) {
    if (!/^[A-Za-z0-9_-]+$/.test(password)) {
        throw new Error('Database password must be base64url text.');
    }
    return `mongodb://${user}:${password}@${LOOPBACK}:${PORTS.mongo}/${database}?authSource=admin&directConnection=true`;
}

/** Health thresholds for the approved platform (README.md "Health"). */
export const HEALTH = Object.freeze({
    heapBytes: 300 * 1024 * 1024,
    rssBytes: 400 * 1024 * 1024,
    diskFullFraction: 0.9,
});

/** The API's environment (node --env-file). No quotes, one per line. */
export function apiEnv(paths, secrets, { storeTimezone = 'Asia/Manila' } = {}) {
    const entries = [
        ['APP_ENV', 'single-pc'],
        ['PORT', String(PORTS.api)],
        ['HOST', LOOPBACK],
        ['FRONTEND_URL', ORIGIN],
        ['DOMAIN', ''],
        ['DATABASE_URL', databaseUrl(DB_USERS.api, secrets.mongoApiPassword)],
        ['COOKIE_SECRET', secrets.cookieSecret],
        ['JWT_SECRET', secrets.jwtSecret],
        ['JWT_EXPIRY_S', '900'],
        ['REFRESH_EXPIRY_S', '604800'],
        ['EAN_COUNTER_ID', 'EAN_COUNTER_ID'],
        ['EAN_COUNTER_DIGITS', '9'],
        ['HEALTH_HEAP_THRESHOLD', String(HEALTH.heapBytes)],
        ['HEALTH_RSS_THRESHOLD', String(HEALTH.rssBytes)],
        ['HEALTH_DISK_THRESHOLD_PERCENT', String(HEALTH.diskFullFraction)],
        ['HEALTH_DISK_PATH', paths.root],
        ['STORE_TIMEZONE', storeTimezone],
    ];
    for (const [key, value] of entries) {
        if (/[\r\n"'#`]/.test(value) || value !== value.trim()) {
            throw new Error(`Unsafe value for ${key} in the API env file.`);
        }
    }
    return (
        '# Generated by packaging/single-pc/runtime/provision.mjs (#360).\n' +
        '# Secrets: readable by the API service identity only. Do not edit.\n' +
        entries.map(([key, value]) => `${key}=${value}`).join('\n') +
        '\n'
    );
}

/**
 * Release (replaceable binaries) layout, under
 * %ProgramFiles%\Valorthon\GroceryPOS\releases\<version>. #362 builds it.
 */
export function releaseLayout(release, { windows = true } = {}) {
    const exe = (name) => (windows ? `${name}.exe` : name);
    return {
        node: join(release, 'node', exe('node')),
        mongod: join(release, 'mongodb', 'bin', exe('mongod')),
        api: join(release, 'api'),
        apiMain: join(release, 'api', 'dist', 'main.js'),
        initialAdmin: join(
            release,
            'api',
            'dist',
            'bootstrap',
            'initial-admin.cli.js',
        ),
        client: join(release, 'client'),
        caddy: join(release, 'caddy', exe('caddy')),
        caddyfile: join(release, 'caddy', 'Caddyfile'),
    };
}

/**
 * Service definitions in start order. Each depends on the previous one;
 * stop runs in reverse. #362 installs them (mongod's own --install for the
 * DB, WinSW for the API and the proxy).
 */
export function serviceDefinitions(paths, release) {
    const bin = releaseLayout(release);
    return [
        {
            name: SERVICES.mongo,
            host: 'mongod',
            executable: bin.mongod,
            arguments: ['--config', paths.mongodConfig],
            dependsOn: [],
            readiness: 'authenticated hello: isWritablePrimary',
            stopTimeoutSeconds: 60,
        },
        {
            name: SERVICES.api,
            host: 'winsw',
            executable: bin.node,
            arguments: [`--env-file=${paths.apiEnv}`, bin.apiMain],
            workingDirectory: bin.api,
            env: {},
            dependsOn: [SERVICES.mongo],
            logDirectory: paths.apiLogs,
            readiness: `GET http://${LOOPBACK}:${PORTS.api}/v1/health/ready`,
            stopTimeoutSeconds: 30,
        },
        {
            name: SERVICES.proxy,
            host: 'winsw',
            executable: bin.caddy,
            arguments: [
                'run',
                '--config',
                bin.caddyfile,
                '--adapter',
                'caddyfile',
            ],
            workingDirectory: join(release, 'caddy'),
            env: {
                GPOS_CLIENT_ROOT: bin.client,
                XDG_DATA_HOME: paths.caddyData,
                XDG_CONFIG_HOME: paths.caddyConfig,
            },
            dependsOn: [SERVICES.api],
            logDirectory: paths.proxyLogs,
            readiness: `GET ${ORIGIN}/v1/health/ready`,
            stopTimeoutSeconds: 30,
        },
    ];
}

function xmlEscape(text) {
    return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function quoteArgument(arg) {
    return /[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;
}

/**
 * WinSW 2.x XML for a `host: 'winsw'` definition: delayed bounded
 * restarts, Ctrl+C then a stop timeout (Nest's shutdown hooks run on
 * SIGINT), size-rolled logs. Runs as the service identity #362 assigns.
 */
export function winswXml(service) {
    if (service.host !== 'winsw') throw new Error('Not a WinSW service.');
    const lines = [
        '<service>',
        `  <id>${xmlEscape(service.name)}</id>`,
        `  <name>${xmlEscape(service.name)}</name>`,
        `  <description>Grocery POS ${xmlEscape(service.name)} (single-PC edition)</description>`,
        `  <executable>${xmlEscape(service.executable)}</executable>`,
        `  <arguments>${xmlEscape(service.arguments.map(quoteArgument).join(' '))}</arguments>`,
        `  <workingdirectory>${xmlEscape(service.workingDirectory)}</workingdirectory>`,
        '  <startmode>Automatic</startmode>',
        ...service.dependsOn.map(
            (dep) => `  <depend>${xmlEscape(dep)}</depend>`,
        ),
        ...Object.entries(service.env).map(
            ([name, value]) =>
                `  <env name="${xmlEscape(name)}" value="${xmlEscape(value)}"/>`,
        ),
        '  <onfailure action="restart" delay="10 sec"/>',
        '  <onfailure action="restart" delay="30 sec"/>',
        '  <onfailure action="none"/>',
        '  <resetfailure>1 hour</resetfailure>',
        `  <stoptimeout>${service.stopTimeoutSeconds} sec</stoptimeout>`,
        '  <stopparentprocessfirst>true</stopparentprocessfirst>',
        `  <logpath>${xmlEscape(service.logDirectory)}</logpath>`,
        '  <log mode="roll-by-size">',
        '    <sizeThreshold>10240</sizeThreshold>',
        '    <keepFiles>5</keepFiles>',
        '  </log>',
        '</service>',
    ];
    return lines.join('\n') + '\n';
}

/** Non-secret manifest for installer/backup/diagnostics (config/runtime.json). */
export function runtimeManifest(paths, install) {
    return {
        schema: RUNTIME_SCHEMA,
        installationId: install.installationId,
        origin: ORIGIN,
        ports: PORTS,
        bind: LOOPBACK,
        replicaSet: REPLICA_SET,
        appDatabase: APP_DATABASE,
        dbUsers: DB_USERS,
        services: SERVICES,
        health: HEALTH,
        paths: {
            root: paths.root,
            ...paths.dirs,
            apiEnv: paths.apiEnv,
            mongodConfig: paths.mongodConfig,
            mongodLog: paths.mongodLog,
            caddyData: paths.caddyData,
        },
    };
}
