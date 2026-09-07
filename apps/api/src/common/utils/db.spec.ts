import { ClientSession, Connection } from 'mongoose';
import { runInTransaction } from './db';
import { AppError, ErrorCode, InternalError, ValidationError } from '../errors';

function mockConnection() {
    const session = {
        withTransaction: jest
            .fn()
            .mockImplementation(async (fn: (s: ClientSession) => unknown) => {
                await fn(session as unknown as ClientSession);
            }),
        endSession: jest.fn().mockResolvedValue(undefined),
    };

    const connection = {
        startSession: jest.fn().mockResolvedValue(session),
    } as unknown as Connection;

    return { connection, session };
}

describe('runInTransaction', () => {
    it('returns the callback result and always ends the session', async () => {
        const { connection, session } = mockConnection();

        const result = await runInTransaction(async () => 'ok', connection);

        expect(result).toBe('ok');
        expect(session.endSession).toHaveBeenCalledTimes(1);
    });

    it('reuses an existing session instead of opening a nested one', async () => {
        const { connection } = mockConnection();
        const existing = {} as ClientSession;

        const result = await runInTransaction(
            async (s) => (s === existing ? 'reused' : 'new'),
            connection,
            existing,
        );

        expect(result).toBe('reused');
        expect(connection.startSession).not.toHaveBeenCalled();
    });

    // Regression: domain errors used to be wrapped in InternalError, which turned
    // every validation failure raised inside a transaction into an opaque 500.
    it('propagates AppError subclasses untouched', async () => {
        const { connection, session } = mockConnection();
        const domainError = new ValidationError(
            ErrorCode.VALIDATION_INVALID_INPUT,
            'Insufficient stock for one or more products',
            [{ product: 'p1', requested: 5, available: 1 }],
        );

        await expect(
            runInTransaction(() => Promise.reject(domainError), connection),
        ).rejects.toBe(domainError);

        await expect(
            runInTransaction(() => Promise.reject(domainError), connection),
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(session.endSession).toHaveBeenCalled();
    });

    it('wraps unexpected errors as InternalError', async () => {
        const { connection } = mockConnection();

        await expect(
            runInTransaction(
                () => Promise.reject(new Error('socket closed')),
                connection,
            ),
        ).rejects.toBeInstanceOf(InternalError);

        await expect(
            runInTransaction(
                () => Promise.reject(new Error('socket closed')),
                connection,
            ),
        ).rejects.toBeInstanceOf(AppError);
    });
});
