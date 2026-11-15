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

/**
 * single-pc data-version gate (#364). The upgrade tool records the data
 * version in the app database (`DATA_VERSION_COLLECTION`) and marks it
 * `migrating` while migrations run. This API starts only on exactly its
 * own `SINGLE_PC_DATA_VERSION` in the `ready` state, so neither an older
 * release after a forward migration nor a newer one before it can run
 * against the data. An absent marker is the #360 baseline, version 1.
 */
export class DataVersionMismatchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DataVersionMismatchError';
    }
}

export interface DataVersionMarker {
    dataVersion?: unknown;
    state?: unknown;
}

export function dataVersionProblem(
    marker: DataVersionMarker | null,
    expected: number,
): string | null {
    const version = marker ? marker.dataVersion : 1;
    const state = marker ? marker.state : 'ready';
    if (state !== 'ready')
        return `The database is being upgraded (state ${String(state)}); finish or roll back the upgrade (upgrade.mjs status).`;
    if (version !== expected)
        return `The database has data version ${String(version)}; this release needs ${expected}. Run the matching release or the upgrade tool.`;
    return null;
}

export async function assertDataVersion(
    connection: Connection,
    expected: number,
    collection: string,
    id: string,
): Promise<void> {
    const db = connection.db;
    if (!db) throw new DataVersionMismatchError('No database connection.');
    const marker = await db
        .collection<{ _id: string } & DataVersionMarker>(collection)
        .findOne({ _id: id });
    const problem = dataVersionProblem(marker, expected);
    if (problem) throw new DataVersionMismatchError(problem);
}

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
