/**
 * Branches of the bootstrap (#361) with mocked models; the real
 * transaction, concurrency and rollback are in test/db/initial-admin.db-spec.ts.
 */
import type { Connection } from 'mongoose';
import { AuditAction, Role } from '@grocery-pos/contracts';
import {
    AlreadyInitializedError,
    BootstrapInputError,
    createInitialAdmin,
} from './initial-admin';
import { AppError, ErrorCode } from '../common/errors';

jest.mock('argon2', () => ({ hash: jest.fn().mockResolvedValue('hash') }));

function query<T>(value: T) {
    const promise = Promise.resolve(value);
    return Object.assign(promise, { session: () => promise });
}

function fakeConnection(opts: {
    marker?: boolean;
    users?: boolean;
    usersInTx?: boolean;
    createError?: Error;
}) {
    const created: Record<string, unknown[]> = {};
    const models: Record<string, unknown> = {};
    const make = (name: string) => ({
        createCollection: jest.fn().mockResolvedValue(undefined),
        init: jest.fn().mockResolvedValue(undefined),
        exists: jest.fn((filter: Record<string, unknown>) => {
            if (name === 'SystemBootstrap') return query(!!opts.marker);
            const tx = Object.keys(filter).length === 0 && created.__tx;
            return query(tx ? !!opts.usersInTx : !!opts.users);
        }),
        create: jest.fn((docs: unknown[]) => {
            if (opts.createError) return Promise.reject(opts.createError);
            (created[name] ??= []).push(...docs);
            return Promise.resolve(docs);
        }),
    });
    const session = {
        withTransaction: async (fn: (s: unknown) => Promise<void>) => {
            created.__tx = [true];
            await fn(session);
        },
        endSession: jest.fn().mockResolvedValue(undefined),
    };
    const connection = {
        models,
        model: (name: string) => (models[name] ??= make(name)),
        startSession: () => Promise.resolve(session),
    } as unknown as Connection;
    return { connection, created };
}

const INPUT = { username: ' Owner ', password: 'temporary-1' };

it('creates the ADMIN, marker and actorless audit entry', async () => {
    const { connection, created } = fakeConnection({});
    await expect(createInitialAdmin(connection, INPUT)).resolves.toMatchObject({
        username: 'owner',
    });
    expect(created.User).toEqual([
        expect.objectContaining({
            name: 'owner',
            roles: [Role.Admin],
            mustChangePassword: true,
        }),
    ]);
    expect(created.AuditLog).toEqual([
        expect.objectContaining({
            actor: null,
            action: AuditAction.SYSTEM_INITIAL_ADMIN_CREATED,
        }),
    ]);
    expect(created.SystemBootstrap).toHaveLength(1);
    // A second call reuses the registered models.
    await createInitialAdmin(connection, INPUT);
});

it.each([{ marker: true }, { users: true }, { usersInTx: true }])(
    'refuses an initialized database (%p)',
    async (opts) => {
        const { connection, created } = fakeConnection(opts);
        await expect(
            createInitialAdmin(connection, INPUT),
        ).rejects.toBeInstanceOf(AlreadyInitializedError);
        expect(created.User).toBeUndefined();
    },
);

it('maps a duplicate marker to already initialized', async () => {
    const { connection } = fakeConnection({
        createError: new AppError(ErrorCode.DB_DUPLICATE_KEY, 400, 'dup'),
    });
    await expect(createInitialAdmin(connection, INPUT)).rejects.toBeInstanceOf(
        AlreadyInitializedError,
    );
});

it('passes other failures through', async () => {
    const { connection } = fakeConnection({
        createError: new AppError(ErrorCode.FORBIDDEN, 403, 'no'),
    });
    await expect(createInitialAdmin(connection, INPUT)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
    });
});

it('validates before touching the database', async () => {
    const { connection } = fakeConnection({});
    await expect(
        createInitialAdmin(connection, { username: 'o', password: 'x' }),
    ).rejects.toBeInstanceOf(BootstrapInputError);
});
