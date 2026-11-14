import type {
    OfflineCatalogPage,
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
/** Persist lease/cursor separately so a page never clones the accumulated catalogue. */
export type OfflineMetadata = Omit<OfflineState, 'products'>;
interface CatalogueRow {
    owner: string;
    lease: string;
    product: OfflineProduct;
}
let opening: Promise<IDBDatabase> | undefined;
export function closeOfflineDatabase(): void {
    void opening?.then((db) => db.close()).catch(() => undefined);
    opening = undefined;
}
function database(): Promise<IDBDatabase> {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(OFFLINE_DB, 2);
        request.onupgradeneeded = (event) => {
            const db = request.result;
            const tx = request.transaction!;
            if (event.oldVersion === 0) {
                db.createObjectStore('state', { keyPath: 'owner' });
                db.createObjectStore('outbox', {
                    keyPath: ['owner', 'request.idempotencyKey'],
                });
            }
            const catalogue = db.createObjectStore('catalogue', {
                keyPath: ['owner', 'lease', 'product._id'],
            });
            // Keep the existing outbox and every immutable receipt/proof intact.
            // The version-change transaction commits catalogue + metadata together.
            const rows = tx.objectStore('state').openCursor();
            rows.onsuccess = () => {
                const cursor = rows.result;
                if (!cursor) return;
                const { products, ...metadata } = cursor.value as OfflineState;
                if (metadata.lease) {
                    for (const product of products ?? [])
                        catalogue.put({
                            owner: metadata.owner,
                            lease: metadata.lease._id,
                            product,
                        });
                }
                cursor.update(metadata);
                cursor.continue();
            };
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
export async function readOfflineMetadata(
    owner: string,
): Promise<OfflineMetadata | undefined> {
    const db = await database();
    return result(
        db.transaction('state').objectStore('state').get(owner) as IDBRequest<
            OfflineMetadata | undefined
        >,
    );
}
export async function readOfflineState(
    owner: string,
): Promise<OfflineState | undefined> {
    const db = await database();
    const tx = db.transaction(['state', 'catalogue']);
    const completed = done(tx);
    const metadata = await result(
        tx.objectStore('state').get(owner) as IDBRequest<
            OfflineMetadata | undefined
        >,
    );
    const rows = metadata?.lease
        ? await result(
              tx
                  .objectStore('catalogue')
                  .getAll(
                      catalogueRange(owner, metadata.lease._id),
                  ) as IDBRequest<CatalogueRow[]>,
          )
        : [];
    await completed;
    return metadata
        ? { ...metadata, products: rows.map((row) => row.product) }
        : undefined;
}
/** Commit terminal identity before issuing an interruptible server lease request. */
export async function getOrCreateOfflineState(
    owner: string,
    newTerminalId: () => string,
): Promise<OfflineMetadata> {
    const db = await database();
    const tx = db.transaction('state', 'readwrite');
    const completed = done(tx);
    const current = await result(
        tx.objectStore('state').get(owner) as IDBRequest<
            OfflineMetadata | undefined
        >,
    );
    const state = current ?? {
        owner,
        terminalId: newTerminalId(),
        lease: null,
        cursor: null,
        suspended: false,
    };
    if (!current) tx.objectStore('state').add(state);
    await completed;
    return state;
}
/** Explicit full replacement for initial snapshots; catalogue paging uses applyOfflinePage. */
export async function saveOfflineState(state: OfflineState): Promise<void> {
    const db = await database();
    const tx = db.transaction(['state', 'catalogue'], 'readwrite');
    const completed = done(tx);
    try {
        const current = await result(
            tx.objectStore('state').get(state.owner) as IDBRequest<
                OfflineMetadata | undefined
            >,
        );
        if (
            current?.suspended &&
            !state.suspended &&
            current.lease?.shift._id === state.lease?.shift._id
        ) {
            tx.abort();
            await completed.catch(() => undefined);
            throw new Error(
                'Offline selling is paused while this shift closes.',
            );
        }
        const { products, ...metadata } = state;
        tx.objectStore('catalogue').delete(ownerRange(state.owner));
        if (state.lease)
            for (const product of products) {
                tx.objectStore('catalogue').put({
                    owner: state.owner,
                    lease: state.lease._id,
                    product,
                });
            }
        tx.objectStore('state').put(metadata);
        await completed;
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
/** A lease transition and removal of its old catalogue become visible atomically.
 * Compare the lease captured before the HTTP request so a late answer cannot
 * replace another tab's newer lease. Same-lease refresh keeps its committed cursor.
 */
export async function activateOfflineLease(
    previous: OfflineMetadata,
    lease: OfflineLeaseView,
): Promise<OfflineMetadata | undefined> {
    const db = await database();
    const tx = db.transaction(['state', 'catalogue'], 'readwrite');
    const completed = done(tx);
    try {
        const current = await result(
            tx.objectStore('state').get(previous.owner) as IDBRequest<
                OfflineMetadata | undefined
            >,
        );
        if (
            !current ||
            current.terminalId !== previous.terminalId ||
            (current.lease?._id !== previous.lease?._id &&
                current.lease?._id !== lease._id) ||
            (current.suspended && current.lease?.shift._id === lease.shift._id)
        ) {
            await completed;
            return undefined;
        }
        const same = current.lease?._id === lease._id;
        const metadata: OfflineMetadata = {
            ...current,
            lease,
            cursor: same ? current.cursor : null,
            suspended: false,
        };
        if (!same)
            tx.objectStore('catalogue').delete(ownerRange(previous.owner));
        tx.objectStore('state').put(metadata);
        await completed;
        return metadata;
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
/** Apply only this page, tombstones and its resume cursor in one transaction.
 * Lease, suspension and request cursor are checked after acquiring the write lock.
 */
export async function applyOfflinePage(
    owner: string,
    lease: string,
    after: string | null,
    page: OfflineCatalogPage,
): Promise<boolean> {
    const db = await database();
    const tx = db.transaction(['state', 'catalogue'], 'readwrite');
    const completed = done(tx);
    try {
        const current = await result(
            tx.objectStore('state').get(owner) as IDBRequest<
                OfflineMetadata | undefined
            >,
        );
        if (
            !current ||
            current.suspended ||
            current.lease?._id !== lease ||
            current.cursor !== after
        ) {
            await completed;
            return false;
        }
        const catalogue = tx.objectStore('catalogue');
        for (const product of page.products) {
            if (product.isActive === false)
                catalogue.delete([owner, lease, product._id]);
            else catalogue.put({ owner, lease, product });
        }
        const last = page.products[page.products.length - 1];
        const cursor =
            page.next ??
            (last ? `${last.updatedAt}|${last._id}` : current.cursor);
        if (cursor !== current.cursor)
            tx.objectStore('state').put({ ...current, cursor });
        await completed;
        return true;
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
const catalogueRange = (owner: string, lease: string): IDBKeyRange =>
    IDBKeyRange.bound([owner, lease], [owner, lease, []], false, true);
/** The compound primary key groups all string receipt keys under their owner. */
const ownerRange = (owner: string): IDBKeyRange =>
    IDBKeyRange.bound([owner], [owner, []], false, true);

export async function queuedOffline(
    owner: string,
    key: string,
): Promise<OfflinePendingSale | undefined> {
    const db = await database();
    return result(
        db
            .transaction('outbox')
            .objectStore('outbox')
            .get([owner, key]) as IDBRequest<OfflinePendingSale | undefined>,
    );
}
export async function pendingOffline(
    owner?: string,
): Promise<OfflinePendingSale[]> {
    const db = await database();
    const entries = await result(
        db
            .transaction('outbox')
            .objectStore('outbox')
            .getAll(
                owner === undefined ? undefined : ownerRange(owner),
            ) as IDBRequest<OfflinePendingSale[]>,
    );
    return entries.sort((a, b) =>
        a.request.soldAt.localeCompare(b.request.soldAt),
    );
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
                OfflineMetadata | undefined
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
                    'This sale key already has a different pending payment. Review pending sales.',
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
): Promise<OfflineMetadata | undefined> {
    const db = await database();
    const tx = db.transaction(['state', 'outbox'], 'readwrite');
    const completed = done(tx);
    const state = await result(
        tx.objectStore('state').get(owner) as IDBRequest<
            OfflineMetadata | undefined
        >,
    );
    const pendingCount = await result(
        tx.objectStore('outbox').count(ownerRange(owner)),
    );
    if (pendingCount > 0) {
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
