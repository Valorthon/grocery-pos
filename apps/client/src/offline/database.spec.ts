import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    PaymentType,
    SaleStatus,
    ShiftStatus,
    TenderType,
    type OfflinePendingSale,
} from '@grocery-pos/contracts';
import {
    blockOffline,
    closeOfflineDatabase,
    pendingOffline,
    queueOffline,
    readOfflineState,
    removeOffline,
    saveOfflineState,
    suspendOffline,
    type OfflineState,
} from './database';
const owner = 'cashier-a';
const leaseId = 'lease-a';
function state(): OfflineState {
    return {
        owner,
        terminalId: 'terminal',
        suspended: false,
        cursor: null,
        products: [],
        lease: {
            _id: leaseId,
            cashier: owner,
            cashierName: 'Cashier A',
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            shift: {
                _id: 'shift',
                status: ShiftStatus.OPEN,
                cashierName: 'Cashier A',
                terminal: 'A',
                openedAt: new Date().toISOString(),
                openingFloat: 10000,
                movements: [],
            },
        },
    };
}
function entry(key = 'receipt-a', who = owner): OfflinePendingSale {
    return {
        owner: who,
        request: {
            lease: leaseId,
            idempotencyKey: key,
            soldAt: new Date().toISOString(),
            amountTendered: 100,
            lines: [],
        },
        receipt: {
            _id: key,
            createdAt: new Date().toISOString(),
            status: SaleStatus.COMPLETED,
            paymentType: PaymentType.CASH,
            referenceNumber: null,
            tenders: [{ type: TenderType.CASH, amount: 100 }],
            amountTendered: 100,
            changeGiven: 0,
            cashierName: who,
            items: [],
            subtotal: 100,
            discount: null,
            totalAmount: 100,
        },
    };
}
beforeEach(() => {
    closeOfflineDatabase();
    vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => {
    closeOfflineDatabase();
    vi.unstubAllGlobals();
});
describe('durable offline outbox', () => {
    it('writes once and survives closing/reopening the database', async () => {
        await saveOfflineState(state());
        const sale = entry();
        await queueOffline(sale);
        closeOfflineDatabase();
        expect(await pendingOffline(owner)).toEqual([sale]);
        expect(await readOfflineState(owner)).toMatchObject({
            owner,
            terminalId: 'terminal',
        });
    });
    it('replays simultaneous same-key local commits once', async () => {
        await saveOfflineState(state());
        const sale = entry();
        const receipts = await Promise.all([
            queueOffline(sale),
            queueOffline(sale),
        ]);
        expect(receipts).toEqual([sale, sale]);
        expect(await pendingOffline(owner)).toHaveLength(1);
    });
    it('refuses a key reused with different collected cash', async () => {
        await saveOfflineState(state());
        const sale = entry();
        await queueOffline(sale);
        await expect(
            queueOffline({
                ...sale,
                request: { ...sale.request, amountTendered: 200 },
            }),
        ).rejects.toThrow('different pending payment');
        expect(await pendingOffline()).toHaveLength(1);
    });
    it('keeps separate cashier queues private while allowing the admin terminal list', async () => {
        await saveOfflineState(state());
        const otherState = { ...state(), owner: 'cashier-b' };
        await saveOfflineState(otherState);
        await queueOffline(entry());
        await queueOffline(entry('receipt-b', 'cashier-b'));
        expect((await pendingOffline(owner)).map((e) => e.owner)).toEqual([
            owner,
        ]);
        expect(await pendingOffline()).toHaveLength(2);
    });
    it.each(['missing', 'suspended', 'expired', 'wrong-lease'])(
        'refuses cash when the lease is %s',
        async (mode) => {
            const saved = state();
            if (mode === 'missing') saved.lease = null;
            if (mode === 'suspended') saved.suspended = true;
            if (mode === 'expired')
                saved.lease!.expiresAt = new Date(Date.now() - 1).toISOString();
            await saveOfflineState(saved);
            const sale = entry();
            if (mode === 'wrong-lease') sale.request.lease = 'another';
            await expect(queueOffline(sale)).rejects.toThrow('not ready');
            expect(await pendingOffline(owner)).toEqual([]);
        },
    );
    it('queues through the last lease millisecond, refuses its exact deadline and retains collected proofs', async () => {
        const clock = vi.spyOn(Date, 'now').mockReturnValue(100900);
        try {
            const saved = state();
            saved.lease!.expiresAt = new Date(200500).toISOString();
            await saveOfflineState(saved);
            clock.mockReturnValue(200499);
            const sale = entry();
            sale.request.lines = [
                {
                    product: 'product',
                    quantity: 1,
                    proof: 'immutable-signed-price',
                },
            ];
            await queueOffline(sale);
            clock.mockReturnValue(200500);
            await expect(queueOffline(entry('too-late'))).rejects.toThrow(
                'expired',
            );
            expect(await pendingOffline(owner)).toEqual([sale]);
            // A durable receipt is replayable after expiry without rewriting its proof.
            expect(await queueOffline(sale)).toEqual(sale);
        } finally {
            clock.mockRestore();
        }
    });
    it('does not clear a collected receipt after quota failure', async () => {
        await saveOfflineState(state());
        const spy = vi
            .spyOn(IDBObjectStore.prototype, 'add')
            .mockImplementation(() => {
                throw new DOMException('full', 'QuotaExceededError');
            });
        await expect(queueOffline(entry())).rejects.toThrow('full');
        spy.mockRestore();
        expect(await pendingOffline()).toEqual([]);
        expect(await readOfflineState(owner)).toMatchObject({
            suspended: false,
        });
    });
    it('blocks a pending sale durably and does not resurrect another tab’s confirmed sale', async () => {
        await saveOfflineState(state());
        const sale = entry();
        await queueOffline(sale);
        await blockOffline(sale, 'Ask admin');
        expect((await pendingOffline())[0]?.blocked).toBe('Ask admin');
        await removeOffline(sale);
        await blockOffline(sale, 'Late failure');
        expect(await pendingOffline()).toEqual([]);
    });
    it('refuses shift release while pending cash is not synced', async () => {
        await saveOfflineState(state());
        await queueOffline(entry());
        await expect(suspendOffline(owner)).rejects.toThrow('Sync all pending');
        expect((await readOfflineState(owner))?.suspended).toBe(false);
    });
    it('atomically pauses all tabs before releasing a drained lease', async () => {
        await saveOfflineState(state());
        await suspendOffline(owner);
        await expect(queueOffline(entry())).rejects.toThrow('not ready');
        await expect(saveOfflineState(state())).rejects.toThrow('shift closes');
        const next = state();
        next.lease!.shift._id = 'next-shift';
        await saveOfflineState(next);
        expect((await readOfflineState(owner))?.suspended).toBe(false);
    });
    it('can release a terminal that has never prepared offline state', async () => {
        expect(await suspendOffline(owner)).toBeUndefined();
    });
});
