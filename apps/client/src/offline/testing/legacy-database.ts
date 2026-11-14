import type { OfflinePendingSale } from '@grocery-pos/contracts';
import { OFFLINE_DB, type OfflineState } from '../database';

/** Seeds the deployed v1 layout, including receipts that must survive upgrade. */
export async function seedLegacyOfflineDatabase(
    states: OfflineState[],
    entries: OfflinePendingSale[] = [],
): Promise<void> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(OFFLINE_DB, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore('state', { keyPath: 'owner' });
            request.result.createObjectStore('outbox', {
                keyPath: ['owner', 'request.idempotencyKey'],
            });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
            reject(request.error ?? new Error('Legacy storage unavailable'));
    });
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(['state', 'outbox'], 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onabort = () =>
                reject(
                    tx.error ?? new Error('Legacy storage transaction failed'),
                );
            tx.onerror = () =>
                reject(
                    tx.error ?? new Error('Legacy storage transaction failed'),
                );
            for (const state of states) tx.objectStore('state').put(state);
            for (const entry of entries) tx.objectStore('outbox').put(entry);
        });
    } finally {
        db.close();
    }
}
