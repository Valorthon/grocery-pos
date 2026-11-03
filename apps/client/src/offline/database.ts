import type {
    OfflineLeaseView,
    OfflinePendingSale,
    OfflineProduct,
} from '@grocery-pos/contracts';
export const OFFLINE_DB = 'grocery_pos_offline_v1';
export interface OfflineState {
    owner: string;
    terminalId: string;
    lease: OfflineLeaseView | null;
    products: OfflineProduct[];
    cursor: string | null;
    suspended: boolean;
}
let opening: Promise<IDBDatabase> | undefined;
export function closeOfflineDatabase(): void {
    void opening?.then((db) => db.close()).catch(() => undefined);
    opening = undefined;
}
function database(): Promise<IDBDatabase> {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(OFFLINE_DB, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            db.createObjectStore('state', { keyPath: 'owner' });
            db.createObjectStore('outbox', {
                keyPath: ['owner', 'request.idempotencyKey'],
            });
        };
        request.onerror = () => {
            opening = undefined;
            reject(request.error ?? new Error('Offline storage unavailable'));
        };
        request.onblocked = () => {
            opening = undefined;
            reject(
                new Error('Close other POS tabs to update offline storage.'),
            );
        };
        request.onsuccess = () => {
            request.result.onversionchange = () => {
                request.result.close();
                opening = undefined;
            };
            resolve(request.result);
        };
    });
    return opening;
}
const result = <T>(request: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
            reject(request.error ?? new Error('Offline storage failed'));
    });
const done = (tx: IDBTransaction): Promise<void> =>
    new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () =>
            reject(tx.error ?? new Error('Offline storage transaction failed'));
        tx.onerror = () =>
            reject(tx.error ?? new Error('Offline storage transaction failed'));
    });
export async function readOfflineState(
    owner: string,
): Promise<OfflineState | undefined> {
    const db = await database();
    return result(
        db.transaction('state').objectStore('state').get(owner) as IDBRequest<
            OfflineState | undefined
        >,
    );
}
/** A read/write transaction serializes first preparation across browser tabs.
 * Commit the identity before issuing a lease so interrupted requests are retried
 * using the same server identity, including after a reload or lost response.
 */
export async function getOrCreateOfflineState(
    owner: string,
    newTerminalId: () => string,
): Promise<OfflineState> {
    const db = await database();
    const tx = db.transaction('state', 'readwrite');
    const completed = done(tx);
    const current = await result(
        tx.objectStore('state').get(owner) as IDBRequest<
            OfflineState | undefined
        >,
    );
    const state = current ?? {
        owner,
        terminalId: newTerminalId(),
        lease: null,
        products: [],
        cursor: null,
        suspended: false,
    };
    if (!current) tx.objectStore('state').add(state);
    await completed;
    return state;
}
export async function saveOfflineState(state: OfflineState): Promise<void> {
    const db = await database();
    const tx = db.transaction('state', 'readwrite');
    const completed = done(tx);
    const current = await result(
        tx.objectStore('state').get(state.owner) as IDBRequest<
            OfflineState | undefined
        >,
    );
    if (
        current?.suspended &&
        !state.suspended &&
        current.lease?.shift._id === state.lease?.shift._id
    ) {
        tx.abort();
        await completed.catch(() => undefined);
        throw new Error('Offline selling is paused while this shift closes.');
    }
    tx.objectStore('state').put(state);
    await completed;
}
export async function pendingOffline(
    owner?: string,
): Promise<OfflinePendingSale[]> {
    const db = await database();
    const entries = await result(
        db.transaction('outbox').objectStore('outbox').getAll() as IDBRequest<
            OfflinePendingSale[]
        >,
    );
    return entries
        .filter((entry) => !owner || entry.owner === owner)
        .sort((a, b) => a.request.soldAt.localeCompare(b.request.soldAt));
}
/** Atomic duplicate detection + durable cash receipt, before clearing any basket. */
export async function queueOffline(
    entry: OfflinePendingSale,
): Promise<OfflinePendingSale> {
    const db = await database();
    const tx = db.transaction(['state', 'outbox'], 'readwrite');
    const completed = done(tx);
    try {
        const state = await result(
            tx.objectStore('state').get(entry.owner) as IDBRequest<
                OfflineState | undefined
            >,
        );
        const prior = await result(
            tx
                .objectStore('outbox')
                .get([entry.owner, entry.request.idempotencyKey]) as IDBRequest<
                OfflinePendingSale | undefined
            >,
        );
        if (prior) {
            if (JSON.stringify(prior.request) !== JSON.stringify(entry.request))
                throw new Error(
                    'This receipt key already has a different pending payment. Review pending sales.',
                );
            await completed;
            return prior;
        }
        if (
            !state?.lease ||
            state.suspended ||
            state.lease._id !== entry.request.lease ||
            new Date(state.lease.expiresAt).getTime() <= Date.now()
        )
            throw new Error(
                'Offline selling is not ready or has expired. Reconnect before collecting cash.',
            );
        tx.objectStore('outbox').add(entry);
        await completed;
        return entry;
    } catch (error) {
        try {
            tx.abort();
        } catch {
            /* Already complete or aborted. */
        }
        await completed.catch(() => undefined);
        throw error;
    }
}
export async function removeOffline(entry: OfflinePendingSale): Promise<void> {
    const db = await database();
    const tx = db.transaction('outbox', 'readwrite');
    const completed = done(tx);
    tx.objectStore('outbox').delete([
        entry.owner,
        entry.request.idempotencyKey,
    ]);
    await completed;
}
export async function blockOffline(
    entry: OfflinePendingSale,
    message: string,
): Promise<void> {
    const db = await database();
    const tx = db.transaction('outbox', 'readwrite');
    const completed = done(tx);
    const stored = await result(
        tx
            .objectStore('outbox')
            .get([entry.owner, entry.request.idempotencyKey]) as IDBRequest<
            OfflinePendingSale | undefined
        >,
    );
    // A late failure cannot resurrect an entry another tab already synced.
    if (stored) tx.objectStore('outbox').put({ ...stored, blocked: message });
    await completed;
}
/** Locks every tab out of enqueueing before releasing the server lease. */
export async function suspendOffline(
    owner: string,
): Promise<OfflineState | undefined> {
    const db = await database();
    const tx = db.transaction(['state', 'outbox'], 'readwrite');
    const completed = done(tx);
    const state = await result(
        tx.objectStore('state').get(owner) as IDBRequest<
            OfflineState | undefined
        >,
    );
    const entries = await result(
        tx.objectStore('outbox').getAll() as IDBRequest<OfflinePendingSale[]>,
    );
    if (entries.some((entry) => entry.owner === owner)) {
        tx.abort();
        await completed.catch(() => undefined);
        throw new Error(
            'Sync all pending cash sales before closing this shift. Blocked sales need admin reconciliation.',
        );
    }
    if (state) tx.objectStore('state').put({ ...state, suspended: true });
    await completed;
    return state;
}
