/**
 * First-install bootstrap (#361) against a real replica set: a fresh
 * database gets exactly one ADMIN (no demo data), a second or concurrent
 * run is refused without changes, a failed transaction leaves nothing, and
 * the temporary password must be changed at first login over HTTP.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as argon from 'argon2';
import { join } from 'node:path';
import { AuditAction, ErrorCode, Role } from '@grocery-pos/contracts';
import { bootDbApp, dbName, read, type DbApp } from './db-app';
import { uriWithDb } from './db-uri';
import {
    AlreadyInitializedError,
    createInitialAdmin,
    INITIAL_ADMIN_MARKER,
} from '../../src/bootstrap/initial-admin';
import { EXIT, run } from '../../src/bootstrap/initial-admin.cli';

let db: DbApp;
let base: string;
const PASSWORD = 'temporary-pass-361';

beforeAll(async () => {
    db = await bootDbApp();
    base = `${(await db.app.getUrl()).replace('[::1]', '127.0.0.1')}/v1`;
});
afterAll(async () => {
    await db?.close();
});
beforeEach(async () => {
    for (const name of ['User', 'AuditLog', 'RefreshToken'])
        await db.connection
            .collection(db.model(name).collection.name)
            .deleteMany({});
    await db.connection.collection('systembootstrap').deleteMany({});
});

const count = (name: string) => db.model(name).countDocuments({});
const markers = () =>
    db.connection.collection('systembootstrap').countDocuments({});
const bootstrapAudits = () =>
    db.model('AuditLog').countDocuments({
        action: AuditAction.SYSTEM_INITIAL_ADMIN_CREATED,
    });

/** A cookie header from a response: the last set value per name, cleared ones left out. */
function cookies(res: Response): string {
    const jar = new Map<string, string>();
    for (const line of res.headers.getSetCookie()) {
        const pair = line.split(';')[0];
        const name = pair.slice(0, pair.indexOf('='));
        if (/Expires=Thu, 01 Jan 1970/i.test(line)) jar.delete(name);
        else jar.set(name, pair);
    }
    return [...jar.values()].join('; ');
}

/** Logs in over HTTP; returns the session's cookie header. */
async function login(username: string, password: string) {
    const res = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    return { status: res.status, cookie: cookies(res) };
}
const call = (cookie: string, method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
        method,
        headers: { cookie, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

it('creates only the ADMIN, its marker and its audit entry', async () => {
    const result = await createInitialAdmin(db.connection, {
        username: '  Owner ',
        password: PASSWORD,
    });
    expect(result.username).toBe('owner');

    const users = await db.model('User').find({}).lean();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
        name: 'owner',
        roles: [Role.Admin],
        isActive: true,
        mustChangePassword: true,
    });
    expect(await count('Product')).toBe(0);
    expect(await count('Inventory')).toBe(0);
    expect(await count('Sales')).toBe(0);
    expect(await markers()).toBe(1);

    const [entry] = await db
        .model('AuditLog')
        .find({ action: AuditAction.SYSTEM_INITIAL_ADMIN_CREATED })
        .lean<Record<string, unknown>[]>();
    expect(entry).toMatchObject({
        actor: null,
        actorName: null,
        targetModel: 'User',
        after: {
            name: 'owner',
            roles: [Role.Admin],
            isActive: true,
            mustChangePassword: true,
            source: 'bootstrap-command',
        },
    });
    expect(String(entry.targetId)).toBe(result.userId);
    expect(JSON.stringify(entry)).not.toContain(PASSWORD);
    expect(JSON.stringify(entry)).not.toContain('argon2');
});

it('refuses an initialized database and changes nothing', async () => {
    await createInitialAdmin(db.connection, {
        username: 'owner',
        password: PASSWORD,
    });
    const before = await db.model('User').find({}).lean();
    await expect(
        createInitialAdmin(db.connection, {
            username: 'other',
            password: PASSWORD,
        }),
    ).rejects.toBeInstanceOf(AlreadyInitializedError);
    expect(await db.model('User').find({}).lean()).toEqual(before);
    expect(await bootstrapAudits()).toBe(1);
});

it('refuses a database that already has users, without a marker', async () => {
    await db.model('User').create({
        name: 'existing',
        roles: [Role.Seller],
        passwordHash: 'x',
        isActive: true,
    });
    await expect(
        createInitialAdmin(db.connection, {
            username: 'owner',
            password: PASSWORD,
        }),
    ).rejects.toBeInstanceOf(AlreadyInitializedError);
    expect(await count('User')).toBe(1);
    expect(await markers()).toBe(0);
    expect(await bootstrapAudits()).toBe(0);
});

it('lets only one of concurrent runs succeed', async () => {
    const results = await Promise.allSettled(
        ['a', 'b', 'c', 'd'].map((name) =>
            createInitialAdmin(db.connection, {
                username: `owner-${name}`,
                password: PASSWORD,
            }),
        ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(3);
    for (const r of refused)
        expect(r.reason).toBeInstanceOf(AlreadyInitializedError);
    expect(await count('User')).toBe(1);
    expect(await markers()).toBe(1);
    expect(await bootstrapAudits()).toBe(1);
});

it('rolls everything back when the transaction fails', async () => {
    await expect(
        createInitialAdmin(
            db.connection,
            { username: 'owner', password: PASSWORD },
            {
                beforeCommit: () => Promise.reject(new Error('disk full')),
            },
        ),
    ).rejects.toThrow();
    expect(await count('User')).toBe(0);
    expect(await markers()).toBe(0);
    expect(await bootstrapAudits()).toBe(0);
    // And a retry then succeeds.
    await createInitialAdmin(db.connection, {
        username: 'owner',
        password: PASSWORD,
    });
    expect(await count('User')).toBe(1);
});

it('requires a password change at first login', async () => {
    await createInitialAdmin(db.connection, {
        username: 'owner',
        password: PASSWORD,
    });
    const first = await login('owner', PASSWORD);
    expect(first.status).toBe(201);

    const profile = await read(
        await call(first.cookie, 'GET', '/users/profile'),
    );
    expect(profile.body).toMatchObject({
        username: 'owner',
        roles: [Role.Admin],
        mustChangePassword: true,
    });
    const users = await read(
        await call(first.cookie, 'GET', '/users?page=1&limit=10'),
    );
    expect(users.status).toBe(403);
    expect(users.body.error).toBe(ErrorCode.USER_PASSWORD_CHANGE_REQUIRED);

    // A refreshed session keeps the requirement (read from the database).
    const refreshed = await call(first.cookie, 'POST', '/auth/refresh');
    expect(refreshed.status).toBe(201);
    const refreshedCookie = cookies(refreshed);
    expect(
        (await read(await call(refreshedCookie, 'GET', '/users/profile'))).body,
    ).toMatchObject({ mustChangePassword: true });
    first.cookie = refreshedCookie;

    const same = await read(
        await call(first.cookie, 'PATCH', '/users/me/password', {
            currentPassword: PASSWORD,
            newPassword: PASSWORD,
        }),
    );
    expect(same.status).toBe(400);
    expect(same.body.error).toBe(ErrorCode.USER_PASSWORD_UNCHANGED);

    const changed = await call(first.cookie, 'PATCH', '/users/me/password', {
        currentPassword: PASSWORD,
        newPassword: 'owner-chosen-pass',
    });
    expect(changed.status).toBe(200);
    const stored = await db
        .model('User')
        .findOne({ name: 'owner' })
        .lean<Record<string, unknown>>();
    expect(stored?.mustChangePassword).toBeUndefined();

    expect((await login('owner', PASSWORD)).status).toBe(401);
    const second = await login('owner', 'owner-chosen-pass');
    expect(second.status).toBe(201);
    const after = await read(
        await call(second.cookie, 'GET', '/users/profile'),
    );
    expect(after.body).not.toHaveProperty('mustChangePassword');
    expect(
        (await call(second.cookie, 'GET', '/users?page=1&limit=10')).status,
    ).toBe(200);
});

// Owner decision on #361: an ADMIN's reset of another user's password is
// temporary too.
it('requires a change after an ADMIN resets a password', async () => {
    await createInitialAdmin(db.connection, {
        username: 'owner',
        password: PASSWORD,
    });
    const first = await login('owner', PASSWORD);
    await call(first.cookie, 'PATCH', '/users/me/password', {
        currentPassword: PASSWORD,
        newPassword: 'owner-chosen-pass',
    });
    const admin = await login('owner', 'owner-chosen-pass');
    const reauth = await call(admin.cookie, 'POST', '/auth/reauth', {
        password: 'owner-chosen-pass',
    });
    expect(reauth.status).toBe(204);
    const created = await call(admin.cookie, 'POST', '/users', {
        users: [
            { name: 'ana', password: 'ana-first-pass', roles: [Role.Seller] },
        ],
    });
    expect(created.status).toBe(201);
    const ana = await db
        .model('User')
        .findOne({ name: 'ana' })
        .lean<{ _id: unknown; mustChangePassword?: boolean }>();
    expect(ana?.mustChangePassword).toBeUndefined();

    const reset = await call(admin.cookie, 'PATCH', '/users', {
        updates: [
            { user: String(ana!._id), update: { password: 'reset-pass-1' } },
        ],
    });
    expect(reset.status).toBe(200);

    const session = await login('ana', 'reset-pass-1');
    expect(session.status).toBe(201);
    expect(
        (await read(await call(session.cookie, 'GET', '/users/profile'))).body,
    ).toMatchObject({ mustChangePassword: true });
    expect((await call(session.cookie, 'GET', '/shifts/current')).status).toBe(
        403,
    );
    expect(
        (
            await call(session.cookie, 'PATCH', '/users/me/password', {
                currentPassword: 'reset-pass-1',
                newPassword: 'ana-own-pass-2',
            })
        ).status,
    ).toBe(200);
    const after = await login('ana', 'ana-own-pass-2');
    expect(
        (await read(await call(after.cookie, 'GET', '/users/profile'))).body,
    ).not.toHaveProperty('mustChangePassword');
});

it('runs from the command with a generated, owner-only password file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gpos-361-'));
    const file = join(dir, 'temporary-password.txt');
    const out: string[] = [];
    const err: string[] = [];
    const io = {
        platform: process.platform,
        stdinIsTTY: false,
        readStdin: () => Promise.resolve(''),
        out: (line: string) => out.push(line),
        err: (line: string) => err.push(line),
    };
    const env = {
        DATABASE_URL: uriWithDb(process.env.MONGO_URI_TEST!, dbName()),
    };
    try {
        const code = await run(
            ['--username', 'owner', '--generate-password-file', file],
            env,
            io,
        );
        expect(code).toBe(EXIT.OK);
        const password = (await readFile(file, 'utf8')).trim();
        expect(password).toHaveLength(24);
        expect([...out, ...err].join('\n')).not.toContain(password);
        // Checked on the stored hash: the login rate limit is per file.
        const stored = await db
            .model('User')
            .findOne({ name: 'owner' })
            .lean<{ passwordHash: string }>();
        expect(await argon.verify(stored!.passwordHash, password)).toBe(true);

        // A second run is refused and leaves no new password file.
        const again = join(dir, 'again.txt');
        expect(
            await run(
                ['--username', 'other', '--generate-password-file', again],
                env,
                io,
            ),
        ).toBe(EXIT.INITIALIZED);
        await expect(readFile(again)).rejects.toThrow();
        expect(await count('User')).toBe(1);
        expect(await db.model('User').exists({ name: 'owner' })).toBeTruthy();
        expect(await markers()).toBe(1);
        expect(
            await db.connection
                .collection('systembootstrap')
                .findOne({ _id: INITIAL_ADMIN_MARKER as never }),
        ).not.toBeNull();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
