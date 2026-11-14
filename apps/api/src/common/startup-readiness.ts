import type { Connection } from 'mongoose';

/**
 * single-pc startup gate (#360): the API listens only once its database
 * answers as an authenticated writable replica-set primary and every
 * registered model's indexes exist (unique and partial indexes enforce
 * shift, idempotency and other rules). After a reboot the local
 * single-node replica set can take a few seconds to elect itself primary;
 * the service host restarts the API if the deadline passes.
 */
export interface ReadinessOptions {
    timeoutMs?: number;
    intervalMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

export const DATABASE_READY_TIMEOUT_MS = 120_000;

export class DatabaseNotReadyError extends Error {
    constructor() {
        super(
            'The database did not become a writable replica-set primary in time.',
        );
        this.name = 'DatabaseNotReadyError';
    }
}

async function isWritablePrimary(connection: Connection): Promise<boolean> {
    try {
        const db = connection.db;
        if (!db) return false;
        const hello = await db.admin().command({ hello: 1 });
        return hello.isWritablePrimary === true && Boolean(hello.setName);
    } catch {
        return false;
    }
}

export async function awaitDatabaseReady(
    connection: Connection,
    {
        timeoutMs = DATABASE_READY_TIMEOUT_MS,
        intervalMs = 500,
        now = () => Date.now(),
        sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    }: ReadinessOptions = {},
): Promise<void> {
    const deadline = now() + timeoutMs;
    while (!(await isWritablePrimary(connection))) {
        if (now() >= deadline) throw new DatabaseNotReadyError();
        await sleep(intervalMs);
    }
    // Model.init() builds the schema's indexes once (autoIndex) and
    // rejects if one cannot be built; that stops the startup.
    await Promise.all(
        Object.values(connection.models).map((model) => model.init()),
    );
}

/**
 * Initial connection retries. Cloud keeps Nest's default (9 × 3 s). On
 * single-pc the API service can start while mongod is still recovering
 * after a power loss, so it keeps retrying for the readiness window
 * before exiting for a service restart (#360).
 */
export const SINGLE_PC_CONNECT_RETRY_DELAY_MS = 3_000;

export function connectionRetryOptions(
    singlePc: boolean,
): { retryAttempts: number; retryDelay: number } | Record<string, never> {
    if (!singlePc) return {};
    return {
        retryAttempts: Math.ceil(
            DATABASE_READY_TIMEOUT_MS / SINGLE_PC_CONNECT_RETRY_DELAY_MS,
        ),
        retryDelay: SINGLE_PC_CONNECT_RETRY_DELAY_MS,
    };
}
