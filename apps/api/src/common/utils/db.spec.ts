import {
    ClientSession,
    Connection,
    Error as MongooseError,
    mongo,
} from 'mongoose';
import { runInTransaction } from './db';
import {
    AppError,
    ConflictError,
    ErrorCode,
    InternalError,
    ValidationError,
} from '../errors';

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

    it('keeps a ConflictError thrown inside the transaction, with its details', async () => {
        const { connection } = mockConnection();
        const payout = new ConflictError(
            ErrorCode.SHIFT_PAYOUT_REQUIRED,
            'Choose a shift to pay from',
            { openShifts: 2 },
        );

        await expect(
            runInTransaction(() => Promise.reject(payout), connection),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: ErrorCode.SHIFT_PAYOUT_REQUIRED,
            details: { openShifts: 2 },
        });
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

    it('keeps the original error as the cause, out of details', async () => {
        const { connection } = mockConnection();
        const socket = new Error('socket closed');

        const err = (await runInTransaction(
            () => Promise.reject(socket),
            connection,
        ).catch((e: unknown) => e)) as InternalError;

        expect(err.statusCode).toBe(500);
        expect(err.cause).toBe(socket);
        expect(err.details).toBeNull();
        expect(err.toResponse('/v1/x', 'id').details).toBeNull();
    });
});

describe('runInTransaction classifies database errors (issue #8)', () => {
    const DUP =
        'E11000 duplicate key error collection: pos.products index: name_1 dup key: { name: "Milk" }';

    it('turns a duplicate key into a 400 DB_DUPLICATE_KEY, not a 500', async () => {
        const { connection } = mockConnection();
        const dup = new mongo.MongoServerError({
            message: DUP,
            code: 11000,
            keyPattern: { name: 1 },
            keyValue: { name: 'Milk' },
        });

        const err = (await runInTransaction(
            () => Promise.reject(dup),
            connection,
        ).catch((e: unknown) => e)) as AppError;

        expect(err).toBeInstanceOf(AppError);
        expect(err).toMatchObject({
            statusCode: 400,
            code: ErrorCode.DB_DUPLICATE_KEY,
            details: [{ msg: 'Already exists', property: 'name' }],
        });
        expect(err.cause).toBe(dup);
        expect(JSON.stringify(err.details)).not.toContain('Milk');
    });

    it('turns a bulk insert duplicate into a 400 naming the index and field', async () => {
        const { connection } = mockConnection();
        const bulk = new mongo.MongoBulkWriteError(
            {
                message: DUP,
                code: 11000,
                // The driver's WriteError keeps the raw error in `err`.
                writeErrors: [
                    {
                        err: {
                            index: 2,
                            code: 11000,
                            errmsg: DUP,
                            op: { name: 'Milk', price: 100 },
                        },
                        get code() {
                            return 11000;
                        },
                    },
                ] as never,
            },
            {} as never,
        );

        await expect(
            runInTransaction(() => Promise.reject(bulk), connection),
        ).rejects.toMatchObject({
            statusCode: 400,
            code: ErrorCode.DB_DUPLICATE_KEY,
            details: [{ msg: 'Already exists', property: 'name', index: 2 }],
        });
    });

    it('reads every field of a compound key from the message when keyPattern is missing', async () => {
        const { connection } = mockConnection();
        const dup = Object.assign(
            new Error(
                'E11000 duplicate key error collection: pos.shifts index: cashier_1_status_1 dup key: { cashier: ObjectId(\'64b7f0c2a1b2c3d4e5f60718\'), status: "OPEN" }',
            ),
            { name: 'MongoServerError', code: 11000 },
        );

        await expect(
            runInTransaction(() => Promise.reject(dup), connection),
        ).rejects.toMatchObject({
            details: [
                { msg: 'Already exists', property: 'cashier' },
                { msg: 'Already exists', property: 'status' },
            ],
        });
    });

    it('turns a Mongoose ValidationError into a 400 DB_VALIDATION_ERROR', async () => {
        const { connection } = mockConnection();
        const invalid = new MongooseError.ValidationError();
        invalid.addError(
            'price',
            new MongooseError.ValidatorError({
                path: 'price',
                message: 'price must be an integer',
            }),
        );

        await expect(
            runInTransaction(() => Promise.reject(invalid), connection),
        ).rejects.toMatchObject({
            statusCode: 400,
            code: ErrorCode.DB_VALIDATION_ERROR,
            details: [{ field: 'price', message: 'price must be an integer' }],
        });
    });

    it('leaves other Mongo errors a 500 with the driver error as the cause', async () => {
        const { connection } = mockConnection();
        const conflict = new mongo.MongoServerError({
            message: 'WriteConflict',
            code: 112,
        });

        const err = (await runInTransaction(
            () => Promise.reject(conflict),
            connection,
        ).catch((e: unknown) => e)) as InternalError;

        expect(err).toBeInstanceOf(InternalError);
        expect(err.cause).toBe(conflict);
    });

    // The driver's withTransaction re-runs the callback on a
    // TransientTransactionError. runInTransaction must hand it the raw error
    // (not a classified or wrapped one) so that retry still happens.
    it('lets withTransaction retry a transient error', async () => {
        const txSession = {} as ClientSession;
        const session = {
            withTransaction: jest.fn(
                async (
                    fn: (s: ClientSession) => Promise<unknown>,
                ): Promise<unknown> => {
                    for (let attempt = 0; ; attempt++) {
                        try {
                            return await fn(txSession);
                        } catch (err) {
                            const transient =
                                err instanceof mongo.MongoError &&
                                err.hasErrorLabel('TransientTransactionError');
                            if (!transient || attempt >= 2) throw err;
                        }
                    }
                },
            ),
            endSession: jest.fn().mockResolvedValue(undefined),
        };
        const connection = {
            startSession: jest.fn().mockResolvedValue(session),
        } as unknown as Connection;

        const fn = jest
            .fn()
            .mockRejectedValueOnce(
                new mongo.MongoServerError({
                    message: 'WriteConflict',
                    code: 112,
                    errorLabels: ['TransientTransactionError'],
                }),
            )
            .mockResolvedValueOnce('committed');

        await expect(runInTransaction(fn, connection)).resolves.toBe(
            'committed',
        );
        expect(fn).toHaveBeenCalledTimes(2);
        expect(session.endSession).toHaveBeenCalledTimes(1);
    });
});
