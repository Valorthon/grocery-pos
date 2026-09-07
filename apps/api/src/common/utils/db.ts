import { ClientSession, Connection } from 'mongoose';
import { AppError, InternalError } from '../errors';

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

        throw new InternalError('Transaction failed', err);
    } finally {
        await newSession.endSession();
    }
}
