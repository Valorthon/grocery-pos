import { ClientSession, Connection } from 'mongoose';
import { AppError, classifyDbError, InternalError } from '../errors';

/**
 * Runs `fn` in a transaction, or inside `session` when the caller already
 * has one.
 *
 * Retries are the driver's: `withTransaction` re-runs `fn` on a
 * `TransientTransactionError` and retries the commit on
 * `UnknownTransactionCommitResult`. The errors are therefore only
 * classified here, after the driver has given up; nothing inside the
 * callback is caught or rewrapped.
 *
 * What reaches the caller:
 * - an `AppError` thrown by `fn`, untouched (status, code and `details`);
 * - a duplicate key or validation failure, as a 400 (`classifyDbError`);
 * - anything else as a 500 `InternalError` whose `cause` is the original
 *   error. The cause is logged by GlobalFilter and never sent back.
 */
export async function runInTransaction<T>(
    fn: (session: ClientSession) => Promise<T>,
    connection: Connection,
    session?: ClientSession,
): Promise<T> {
    if (session) {
        return fn(session);
    }

    const newSession = await connection.startSession();

    try {
        let result: T;

        await newSession.withTransaction(async (s) => {
            result = await fn(s);
        });

        return result!;
    } catch (err) {
        // Domain errors already carry their own status code and ErrorCode.
        // Wrapping them turned every validation failure inside a transaction
        // (insufficient stock, unknown product) into an opaque 500.
        if (err instanceof AppError) throw err;

        throw (
            classifyDbError(err) ??
            new InternalError('Transaction failed', null, { cause: err })
        );
    } finally {
        await newSession.endSession();
    }
}
