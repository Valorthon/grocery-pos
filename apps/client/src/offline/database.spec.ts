import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
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
    queuedOffline,
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
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
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

it('reads an owner range and counts only that owner when suspending', async () => {
    await saveOfflineState(state());
    await saveOfflineState({ ...state(), owner: 'cashier-b' });
    await queueOffline(entry('other', 'cashier-b'));
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    const count = vi.spyOn(IDBObjectStore.prototype, 'count');
    expect(await pendingOffline(owner)).toEqual([]);
    const range = getAll.mock.calls[0]?.[0] as IDBKeyRange;
    expect(range.includes([owner, 'anything'])).toBe(true);
    expect(range.includes(['cashier-b', 'other'])).toBe(false);
    getAll.mockClear();
    expect(await suspendOffline(owner)).toMatchObject({ suspended: false });
    expect(getAll).not.toHaveBeenCalled();
    expect(count).toHaveBeenCalledTimes(1);
    const countRange = count.mock.calls[0]?.[0] as IDBKeyRange;
    expect(countRange.includes([owner, 'anything'])).toBe(true);
    expect(countRange.includes(['cashier-b', 'other'])).toBe(false);
});

it('looks up one owner and key without reading unrelated large blocked receipts', async () => {
    await saveOfflineState(state());
    const matching = entry('same-key');
    await queueOffline(matching);
    const otherOwner = 'cashier-b';
    await saveOfflineState({ ...state(), owner: otherOwner });
    for (let i = 0; i < 20; i++) {
        const other = entry(i === 0 ? 'same-key' : `other-${i}`, otherOwner);
        other.request.lines = Array.from({ length: 200 }, (_, n) => ({
            product: `product-${n}`,
            quantity: 1,
            proof: `signed-proof-${n}`,
        }));
        await queueOffline(other);
        await blockOffline(other, 'Admin reconciliation required');
    }
    await blockOffline(matching, 'Own receipt needs review');
    const get = vi.spyOn(IDBObjectStore.prototype, 'get');
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    expect(await queuedOffline(owner, 'same-key')).toEqual({
        ...matching,
        blocked: 'Own receipt needs review',
    });
    expect(await queuedOffline(owner, 'other-1')).toBeUndefined();
    expect(await queuedOffline('absent-owner', 'same-key')).toBeUndefined();
    expect(get.mock.calls).toEqual([
        [[owner, 'same-key']],
        [[owner, 'other-1']],
        [['absent-owner', 'same-key']],
    ]);
    expect(getAll).not.toHaveBeenCalled();
    await expect(suspendOffline(owner)).rejects.toThrow('Sync all pending');
    expect(getAll).not.toHaveBeenCalled();
});
it('keeps owner and all-owner list ordering including blocked receipts and equal timestamps', async () => {
    await saveOfflineState(state());
    await saveOfflineState({ ...state(), owner: 'cashier-aa' });
    const earlier = entry('a-early');
    earlier.request.soldAt = '2026-11-01T00:00:00.000Z';
    const later = entry('z-late');
    later.request.soldAt = '2026-11-02T00:00:00.000Z';
    const tie = entry('b-tie');
    tie.request.soldAt = earlier.request.soldAt;
    const other = entry('other', 'cashier-aa');
    other.request.soldAt = '2026-10-31T00:00:00.000Z';
    await queueOffline(later);
    await queueOffline(tie);
    await queueOffline(other);
    await queueOffline(earlier);
    await blockOffline(tie, 'Needs reconciliation');
    const blocked = { ...tie, blocked: 'Needs reconciliation' };
    expect(await pendingOffline(owner)).toEqual([earlier, blocked, later]);
    expect(await pendingOffline()).toEqual([other, earlier, blocked, later]);
    expect(await pendingOffline('cashier')).toEqual([]);
    expect(await pendingOffline('')).toEqual([]);
    await expect(suspendOffline(owner)).rejects.toThrow('Sync all pending');
});
