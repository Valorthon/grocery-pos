import { ClientSession, Connection } from 'mongoose';
import { InternalError } from '../errors';

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
        throw new InternalError('Transaction failed', err);
    } finally {
        await newSession.endSession();
    }
}
