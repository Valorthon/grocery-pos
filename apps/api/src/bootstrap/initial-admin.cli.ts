/**
 * Operator/installer command (#361), compiled to
 * `dist/bootstrap/initial-admin.cli.js` and run with plain Node from the
 * packaged API (no ts-node, no source checkout):
 *
 *   node dist/bootstrap/initial-admin.cli.js --username <name> \
 *       (--generate-password-file <new file> | --password-file <file> | --password-stdin)
 *
 * The database comes from `DATABASE_URL`, as for the API. The password is
 * never an argument and never printed:
 * - `--generate-password-file` writes a new random temporary password to a
 *   file that must not exist yet (owner-only on POSIX; on Windows the
 *   installer places it in an ACL-protected directory) for the handover;
 *   it is removed again when the account is not created;
 * - `--password-file` reads the first line of an operator-written file;
 * - `--password-stdin` reads the first line of standard input.
 *
 * Exit codes: 0 created, 2 usage or input error, 3 already initialized
 * (nothing changed), 1 any other failure.
 */
import { randomBytes } from 'node:crypto';
import { open, readFile, stat, unlink } from 'node:fs/promises';
import mongoose from 'mongoose';
import {
    AlreadyInitializedError,
    BootstrapInputError,
    createInitialAdmin,
    normalizeInitialAdmin,
} from './initial-admin';

export const EXIT = { OK: 0, FAILED: 1, USAGE: 2, INITIALIZED: 3 } as const;

export const USAGE =
    'Usage: initial-admin --username <name> (--generate-password-file <path> | --password-file <path> | --password-stdin)\n' +
    'Reads DATABASE_URL from the environment.';

export type PasswordSource =
    | { kind: 'generate'; path: string }
    | { kind: 'file'; path: string }
    | { kind: 'stdin' };

export interface CliArgs {
    username: string;
    source: PasswordSource;
}

export function parseArgs(argv: readonly string[]): CliArgs {
    let username: string | undefined;
    const sources: PasswordSource[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = () => {
            const next = argv[++i];
            if (next === undefined || next.startsWith('--'))
                throw new BootstrapInputError(`${arg} needs a value.`);
            return next;
        };
        if (arg === '--username') username = value();
        else if (arg === '--generate-password-file')
            sources.push({ kind: 'generate', path: value() });
        else if (arg === '--password-file')
            sources.push({ kind: 'file', path: value() });
        else if (arg === '--password-stdin') sources.push({ kind: 'stdin' });
        else throw new BootstrapInputError(`Unknown argument ${arg}.`);
    }
    if (username === undefined)
        throw new BootstrapInputError('--username is required.');
    if (sources.length !== 1)
        throw new BootstrapInputError(
            'Give exactly one of --generate-password-file, --password-file or --password-stdin.',
        );
    return { username, source: sources[0] };
}

/** The first line, without its line ending. */
export function firstLine(text: string): string {
    return text.split(/\r?\n/, 1)[0] ?? '';
}

/** 18 random bytes as base64url: 24 characters, within the password limits. */
export function generatePassword(): string {
    return randomBytes(18).toString('base64url');
}

export interface CliIo {
    platform: NodeJS.Platform;
    /** True when standard input is an interactive terminal (it would echo). */
    stdinIsTTY: boolean;
    readStdin(): Promise<string>;
    out(line: string): void;
    err(line: string): void;
}

/** Reads (or generates and stores) the temporary password. */
export async function obtainPassword(
    source: PasswordSource,
    io: CliIo,
): Promise<string> {
    if (source.kind === 'stdin') {
        if (io.stdinIsTTY)
            throw new BootstrapInputError(
                '--password-stdin reads a pipe or redirected file, not a terminal (it would show the password).',
            );
        return firstLine(await io.readStdin());
    }
    if (io.platform === 'win32') io.err(WINDOWS_FILE_WARNING);
    if (source.kind === 'file') {
        if (io.platform !== 'win32') {
            const { mode } = await stat(source.path);
            if (mode & 0o077)
                throw new BootstrapInputError(
                    'The password file must be readable by its owner only (chmod 600).',
                );
        }
        return firstLine(await readFile(source.path, 'utf8'));
    }
    const password = generatePassword();
    // `wx`: never overwrite an existing file (or follow a planted one).
    const file = await open(source.path, 'wx', 0o600);
    try {
        await file.writeFile(`${password}\n`, 'utf8');
    } finally {
        await file.close();
    }
    return password;
}

/**
 * Windows ignores the file mode: the file inherits its directory's ACL.
 * Keeping it in an installer-restricted directory is a #362 packaging
 * requirement.
 */
export const WINDOWS_FILE_WARNING =
    'Warning: on Windows this file is not ACL-protected by this command. Keep it only in a directory the installer restricts to the operator/owner (never a shared or Public folder).';

/** Credentials in any MongoDB URI: `mongodb(+srv)://user:pass@`. */
const URI_CREDENTIALS = /(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi;

/** An error message for the operator, with database credentials kept out. */
export function safeMessage(err: unknown, databaseUrl?: string): string {
    const message = err instanceof Error ? err.message : String(err);
    const withoutUrl = databaseUrl
        ? message.split(databaseUrl).join('<DATABASE_URL>')
        : message;
    return withoutUrl.replace(URI_CREDENTIALS, '$1<credentials>@');
}

function isExists(err: unknown): boolean {
    return (err as NodeJS.ErrnoException | undefined)?.code === 'EEXIST';
}

export interface RunDeps {
    connect(uri: string): Promise<mongoose.Connection>;
    create: typeof createInitialAdmin;
}

const defaultDeps: RunDeps = {
    connect: async (uri) =>
        mongoose
            .createConnection(uri, { serverSelectionTimeoutMS: 15_000 })
            .asPromise(),
    create: createInitialAdmin,
};

export async function run(
    argv: readonly string[],
    env: NodeJS.ProcessEnv,
    io: CliIo,
    deps: RunDeps = defaultDeps,
): Promise<number> {
    let args: CliArgs;
    try {
        args = parseArgs(argv);
    } catch (err) {
        io.err(safeMessage(err));
        io.err(USAGE);
        return EXIT.USAGE;
    }
    const databaseUrl = env.DATABASE_URL;
    if (!databaseUrl) {
        io.err('DATABASE_URL is not set.');
        return EXIT.USAGE;
    }

    let password: string;
    try {
        password = await obtainPassword(args.source, io);
        normalizeInitialAdmin({ username: args.username, password });
    } catch (err) {
        // Never delete a file this run did not create.
        if (args.source.kind === 'generate' && !isExists(err))
            await unlink(args.source.path).catch(() => undefined);
        io.err(safeMessage(err));
        return err instanceof BootstrapInputError ? EXIT.USAGE : EXIT.FAILED;
    }

    let connection: mongoose.Connection | undefined;
    let created = false;
    try {
        connection = await deps.connect(databaseUrl);
        const result = await deps.create(connection, {
            username: args.username,
            password,
        });
        created = true;
        io.out(
            `Created the initial ADMIN "${result.username}" (${result.userId}). The password must be changed at first login.`,
        );
        if (args.source.kind === 'generate')
            io.out(
                `The temporary password is in ${args.source.path}. Hand it over securely, then delete the file.`,
            );
        return EXIT.OK;
    } catch (err) {
        io.err(safeMessage(err, databaseUrl));
        if (err instanceof AlreadyInitializedError) return EXIT.INITIALIZED;
        if (err instanceof BootstrapInputError) return EXIT.USAGE;
        return EXIT.FAILED;
    } finally {
        if (!created && args.source.kind === 'generate')
            await unlink(args.source.path).catch(() => undefined);
        await connection?.close();
    }
}

export async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
}

/* istanbul ignore next: the process entry point */
if (require.main === module) {
    void run(process.argv.slice(2), process.env, {
        platform: process.platform,
        stdinIsTTY: process.stdin.isTTY === true,
        readStdin: () => readAll(process.stdin),
        out: (line) => process.stdout.write(`${line}\n`),
        err: (line) => process.stderr.write(`${line}\n`),
    }).then((code) => {
        process.exitCode = code;
    });
}
