import {
    chmod,
    mkdtemp,
    readFile,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Connection } from 'mongoose';
import {
    EXIT,
    firstLine,
    generatePassword,
    obtainPassword,
    parseArgs,
    readAll,
    run,
    safeMessage,
    WINDOWS_FILE_WARNING,
    type CliIo,
    type RunDeps,
} from './initial-admin.cli';
import {
    AlreadyInitializedError,
    BootstrapInputError,
    normalizeInitialAdmin,
} from './initial-admin';

let dir: string;
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gpos-cli-'));
});
afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

function io(
    stdin = '',
    platform: NodeJS.Platform = 'linux',
    stdinIsTTY = false,
) {
    const out: string[] = [];
    const err: string[] = [];
    const value: CliIo = {
        platform,
        stdinIsTTY,
        readStdin: () => Promise.resolve(stdin),
        out: (line) => out.push(line),
        err: (line) => err.push(line),
    };
    return { io: value, out, err, all: () => [...out, ...err].join('\n') };
}

function deps(create: RunDeps['create'] = jest.fn()) {
    const close = jest.fn().mockResolvedValue(undefined);
    const connect = jest
        .fn()
        .mockResolvedValue({ close } as unknown as Connection);
    return { connect, create, close };
}

const ENV = { DATABASE_URL: 'mongodb://admin:s3cret@localhost:27018/pos' };

describe('parseArgs', () => {
    it('takes a username and exactly one password source', () => {
        expect(parseArgs(['--username', 'owner', '--password-stdin'])).toEqual({
            username: 'owner',
            source: { kind: 'stdin' },
        });
        expect(
            parseArgs(['--password-file', 'p.txt', '--username', 'owner']),
        ).toEqual({
            username: 'owner',
            source: { kind: 'file', path: 'p.txt' },
        });
        expect(
            parseArgs([
                '--username',
                'owner',
                '--generate-password-file',
                'new.txt',
            ]).source,
        ).toEqual({ kind: 'generate', path: 'new.txt' });
    });

    it.each([
        [[]],
        [['--password-stdin']],
        [['--username', 'owner']],
        [['--username', 'owner', '--password-stdin', '--password-file', 'x']],
        [['--username', '--password-stdin']],
        [['--username', 'owner', '--password', 'secret']],
    ])('refuses %j', (argv) => {
        expect(() => parseArgs(argv)).toThrow(BootstrapInputError);
    });
});

describe('helpers', () => {
    it('reads the first line without its ending', () => {
        expect(firstLine('secret-pass\r\nmore')).toBe('secret-pass');
        expect(firstLine('secret-pass\n')).toBe('secret-pass');
        expect(firstLine('')).toBe('');
    });

    it('generates distinct passwords within the limits', () => {
        const a = generatePassword();
        expect(a).toMatch(/^[A-Za-z0-9_-]{24}$/);
        expect(generatePassword()).not.toBe(a);
        expect(() =>
            normalizeInitialAdmin({ username: 'x', password: a }),
        ).not.toThrow();
    });

    it('validates like POST /users', () => {
        expect(
            normalizeInitialAdmin({
                username: ' Owner ',
                password: '12345678',
            }),
        ).toEqual({ username: 'owner', password: '12345678' });
        expect(() =>
            normalizeInitialAdmin({ username: '  ', password: '12345678' }),
        ).toThrow(BootstrapInputError);
        expect(() =>
            normalizeInitialAdmin({
                username: 'x'.repeat(31),
                password: '12345678',
            }),
        ).toThrow(BootstrapInputError);
        expect(() =>
            normalizeInitialAdmin({ username: 'owner', password: 'short' }),
        ).toThrow(BootstrapInputError);
        expect(() =>
            normalizeInitialAdmin({
                username: 'owner',
                password: 'x'.repeat(65),
            }),
        ).toThrow(BootstrapInputError);
    });

    it('keeps the database URL out of messages', () => {
        expect(
            safeMessage(
                new Error(`cannot reach ${ENV.DATABASE_URL}`),
                ENV.DATABASE_URL,
            ),
        ).toBe('cannot reach <DATABASE_URL>');
        expect(safeMessage('plain')).toBe('plain');
        expect(
            safeMessage(
                new Error(
                    'failed mongodb+srv://u:p%40ss@host/db and mongodb://a:b@h:1',
                ),
            ),
        ).toBe(
            'failed mongodb+srv://<credentials>@host/db and mongodb://<credentials>@h:1',
        );
    });

    it('reads a whole stream', async () => {
        expect(await readAll(Readable.from(['ab', Buffer.from('cd')]))).toBe(
            'abcd',
        );
    });
});

describe('obtainPassword', () => {
    it('refuses an interactive terminal on stdin', async () => {
        const t = io('typed', 'linux', true);
        await expect(obtainPassword({ kind: 'stdin' }, t.io)).rejects.toThrow(
            BootstrapInputError,
        );
    });

    it('warns on Windows that a password file is not ACL-protected', async () => {
        const path = join(dir, 'w.txt');
        const t = io('', 'win32');
        await obtainPassword({ kind: 'generate', path }, t.io);
        expect(t.err).toEqual([WINDOWS_FILE_WARNING]);
        const posix = io();
        await obtainPassword({ kind: 'file', path }, posix.io).catch(
            () => undefined,
        );
        expect(posix.err).toEqual([]);
    });

    it('reads stdin', async () => {
        expect(
            await obtainPassword({ kind: 'stdin' }, io('from-stdin-1\n').io),
        ).toBe('from-stdin-1');
    });

    it('reads an owner-only file', async () => {
        const path = join(dir, 'p.txt');
        await writeFile(path, 'from-file-123\n', { mode: 0o600 });
        expect(await obtainPassword({ kind: 'file', path }, io().io)).toBe(
            'from-file-123',
        );
    });

    it('refuses a file others can read on POSIX, not on Windows', async () => {
        const path = join(dir, 'p.txt');
        await writeFile(path, 'from-file-123\n');
        await chmod(path, 0o644);
        await expect(
            obtainPassword({ kind: 'file', path }, io().io),
        ).rejects.toThrow(BootstrapInputError);
        expect(
            await obtainPassword({ kind: 'file', path }, io('', 'win32').io),
        ).toBe('from-file-123');
    });

    it('writes a generated password to a new owner-only file', async () => {
        const path = join(dir, 'new.txt');
        const password = await obtainPassword(
            { kind: 'generate', path },
            io().io,
        );
        expect(await readFile(path, 'utf8')).toBe(`${password}\n`);
        if (process.platform !== 'win32')
            expect((await stat(path)).mode & 0o777).toBe(0o600);
        // Never overwrites.
        await expect(
            obtainPassword({ kind: 'generate', path }, io().io),
        ).rejects.toMatchObject({ code: 'EEXIST' });
        expect(await readFile(path, 'utf8')).toBe(`${password}\n`);
    });
});

describe('run', () => {
    it('creates the admin and never prints the password', async () => {
        const create = jest
            .fn()
            .mockResolvedValue({ userId: 'id-1', username: 'owner' });
        const d = deps(create);
        const t = io('stdin-password-1\n');
        expect(
            await run(
                ['--username', 'Owner', '--password-stdin'],
                ENV,
                t.io,
                d,
            ),
        ).toBe(EXIT.OK);
        expect(d.connect).toHaveBeenCalledWith(ENV.DATABASE_URL);
        expect(create).toHaveBeenCalledWith(expect.anything(), {
            username: 'Owner',
            password: 'stdin-password-1',
        });
        expect(t.all()).toContain('Created the initial ADMIN "owner"');
        expect(t.all()).not.toContain('stdin-password-1');
        expect(d.close).toHaveBeenCalled();
    });

    it('is a usage error without arguments or DATABASE_URL', async () => {
        const d = deps();
        expect(await run([], ENV, io().io, d)).toBe(EXIT.USAGE);
        expect(
            await run(['--username', 'o', '--password-stdin'], {}, io().io, d),
        ).toBe(EXIT.USAGE);
        expect(d.connect).not.toHaveBeenCalled();
    });

    it('refuses a bad password before connecting', async () => {
        const d = deps();
        expect(
            await run(
                ['--username', 'owner', '--password-stdin'],
                ENV,
                io('short\n').io,
                d,
            ),
        ).toBe(EXIT.USAGE);
        expect(d.connect).not.toHaveBeenCalled();
    });

    it('reports an initialized database and removes the generated file', async () => {
        const create = jest
            .fn()
            .mockRejectedValue(new AlreadyInitializedError());
        const path = join(dir, 'new.txt');
        const t = io();
        expect(
            await run(
                ['--username', 'owner', '--generate-password-file', path],
                ENV,
                t.io,
                deps(create),
            ),
        ).toBe(EXIT.INITIALIZED);
        await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(t.all()).toContain('already initialized');
    });

    it('keeps an existing file it did not create', async () => {
        const path = join(dir, 'existing.txt');
        await writeFile(path, 'keep me\n', { mode: 0o600 });
        const d = deps();
        expect(
            await run(
                ['--username', 'owner', '--generate-password-file', path],
                ENV,
                io().io,
                d,
            ),
        ).toBe(EXIT.FAILED);
        expect(await readFile(path, 'utf8')).toBe('keep me\n');
        expect(d.connect).not.toHaveBeenCalled();
    });

    it('fails without leaking the database URL', async () => {
        const d = {
            connect: jest
                .fn()
                .mockRejectedValue(
                    new Error(`connect failed: ${ENV.DATABASE_URL}`),
                ),
            create: jest.fn(),
        };
        const t = io('stdin-password-1\n');
        expect(
            await run(
                ['--username', 'owner', '--password-stdin'],
                ENV,
                t.io,
                d,
            ),
        ).toBe(EXIT.FAILED);
        expect(t.all()).not.toContain('s3cret');
    });

    it('maps an input error from creation to a usage error', async () => {
        const create = jest
            .fn()
            .mockRejectedValue(new BootstrapInputError('bad'));
        expect(
            await run(
                ['--username', 'owner', '--password-stdin'],
                ENV,
                io('stdin-password-1').io,
                deps(create),
            ),
        ).toBe(EXIT.USAGE);
    });
});
