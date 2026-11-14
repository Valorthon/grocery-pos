import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { createPinia, setActivePinia } from 'pinia';
import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
    ErrorCode,
    PaymentType,
    Role,
    ShiftStatus,
    TenderType,
    UnitOfMeasure,
    type OfflineLeaseView,
    type OfflineProduct,
    type SaleRequest,
} from '@grocery-pos/contracts';
import api from '@/axios';
import {
    closeOfflineDatabase,
    pendingOffline,
    readOfflineState,
    saveOfflineState,
} from '@/offline/database';
import { PROBE_TIMEOUT_MS, useOfflineStore } from './offline';
import { seedLegacyOfflineDatabase } from '@/offline/testing/legacy-database';
vi.mock('@/axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const USER = '0123456789abcdef01234567';
const PRODUCT = '111111111111111111111111';
const SHIFT = '222222222222222222222222';
const LEASE = '333333333333333333333333';
const lease = (): OfflineLeaseView => ({
    _id: LEASE,
    cashier: USER,
    cashierName: 'cashier',
    issuedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    shift: {
        _id: SHIFT,
        status: ShiftStatus.OPEN,
        cashierName: 'cashier',
        openedAt: new Date().toISOString(),
        terminal: 'A',
        openingFloat: 10000,
        movements: [],
    },
});
const product = (): OfflineProduct => ({
    _id: PRODUCT,
    EAN: '4006381333931',
    name: 'rice',
    price: 18000,
    unit: UnitOfMeasure.KG,
    proof: 'server-proof',
    updatedAt: new Date().toISOString(),
});
const body = (): SaleRequest => ({
    idempotencyKey: 'b423583a-5cbf-4d70-ae8b-1c55e1075103',
    paymentType: PaymentType.CASH,
    sellDetails: [{ product: PRODUCT, quantity: 450 }],
    tenders: [{ type: TenderType.CASH, amount: 10000 }],
});
const items = () => [
    {
        product: PRODUCT,
        EAN: '4006381333931',
        name: 'rice',
        unitPrice: 18000,
        unit: UnitOfMeasure.KG,
        quantity: 450,
    },
];
let store: ReturnType<typeof useOfflineStore>;
const acknowledged = async (path: string, data?: unknown) => {
    if (path === '/offline/lease') return { data: lease() };
    if (path === '/offline/sync' || path === '/offline/reconcile') {
        const key = (data as { idempotencyKey: string }).idempotencyKey;
        const saved = (await pendingOffline()).find(
            (e) => e.request.idempotencyKey === key,
        )!;
        return { data: { ...saved.receipt, _id: '444444444444444444444444' } };
    }
    return { data: {} };
};

function failure(status?: number, error?: ErrorCode) {
    return new AxiosError(
        'network unavailable',
        status ? 'ERR_BAD_RESPONSE' : 'ERR_NETWORK',
        undefined,
        undefined,
        status
            ? {
                  status,
                  statusText: 'Failed',
                  config: { headers: new AxiosHeaders() },
                  headers: {},
                  data: { error, message: 'Ask admin' },
              }
            : undefined,
    );
}
beforeEach(async () => {
    closeOfflineDatabase();
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    setActivePinia(createPinia());
    await saveOfflineState({
        owner: USER,
        terminalId: 'terminal',
        lease: lease(),
        products: [product()],
        cursor: null,
        suspended: false,
    });
    store = useOfflineStore();
    await store.restore(USER, [Role.Seller]);
    vi.mocked(api.get).mockResolvedValue({
        data: { products: [product()], next: null },
    });
    vi.mocked(api.post).mockImplementation(acknowledged);
});
afterEach(() => {
    closeOfflineDatabase();
    vi.unstubAllGlobals();
});
it('restores a valid private lease for offline reload and forgets only in-memory state on logout', async () => {
    expect(store.ready).toBe(true);
    store.reset();
    expect(store.owner).toBeNull();
    expect((await readOfflineState(USER))?.lease?._id).toBe(LEASE);
});
it('does not restore another cashier’s private cache', async () => {
    expect(await store.restore('another', [Role.Seller])).toBeNull();
    expect(store.state).toBeNull();
});
it('keeps queued cash private to its cashier while admins can explicitly reconcile on this terminal', async () => {
    await store.queue(body(), items());
    await store.restore('another', [Role.Seller]);
    expect(store.pending).toEqual([]);
    await store.restore('admin', [Role.Admin]);
    expect(store.pending).toHaveLength(1);
    await store.reconcileEntry(store.pending[0]!, 'Cash independently counted');
    expect(api.post).toHaveBeenCalledWith(
        '/offline/reconcile',
        expect.objectContaining({ reason: 'Cash independently counted' }),
    );
    expect(await pendingOffline()).toEqual([]);
});
it('prepares bounded catalogue pages and syncs at most one concurrent preparation', async () => {
    vi.mocked(api.get)
        .mockResolvedValueOnce({
            data: { products: [product()], next: 'cursor' },
        })
        .mockResolvedValueOnce({ data: { products: [], next: null } });
    await Promise.all([
        store.prepare(lease().shift),
        store.prepare(lease().shift),
    ]);
    expect(
        vi
            .mocked(api.post)
            .mock.calls.filter(([path]) => path === '/offline/lease'),
    ).toHaveLength(1);
    expect(store.state?.products).toHaveLength(1);
    expect(store.error).toBe('');
});
it('does not enable a terminal after another tab starts closing its shift', async () => {
    const saved = (await readOfflineState(USER))!;
    await saveOfflineState({ ...saved, suspended: true });
    await store.prepare(lease().shift);
    expect(api.post).not.toHaveBeenCalled();
});
it('preserves a usable cache when catalogue refresh loses the network', async () => {
    vi.mocked(api.get).mockRejectedValue(failure());
    await store.prepare(lease().shift);
    expect(store.offline).toBe(true);
    expect(store.ready).toBe(true);
});
it('reports a server refusal without falsely claiming the network is offline', async () => {
    vi.mocked(api.post).mockRejectedValue(failure(409));
    await store.prepare(lease().shift);
    expect(store.connected).toBe(true);
    expect(store.error).toContain('Ask admin');
});
it('creates and persists terminal identity before starting an interruptible lease request', async () => {
    await store.restore('new-cashier', [Role.Seller]);
    vi.mocked(api.post).mockImplementation(async () => {
        expect(
            (await readOfflineState('new-cashier'))?.terminalId,
        ).toBeTruthy();
        throw failure();
    });
    await store.prepare(lease().shift);
});
it('uses online product lookup while connected and cached lookup after a network failure', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
        data: { ...product(), price: 20000 },
    });
    expect((await store.product(product().EAN)).price).toBe(20000);
    vi.mocked(api.get).mockRejectedValueOnce(failure());
    expect((await store.product(product().EAN)).price).toBe(18000);
    expect(store.offline).toBe(true);
});
it('does not hide online 404s as offline success', async () => {
    vi.mocked(api.get).mockRejectedValue(failure(404));
    await expect(store.product(product().EAN)).rejects.toBeInstanceOf(
        AxiosError,
    );
    expect(store.connected).toBe(true);
});
it('searches cached names and barcodes without a request when offline', async () => {
    store.setConnection(false);
    expect(await store.matches('RICE')).toEqual([
        expect.objectContaining({ product: PRODUCT }),
    ]);
    expect(await store.matches('4006')).toHaveLength(1);
    expect(await store.matches('missing')).toEqual([]);
    expect(api.get).not.toHaveBeenCalled();
});
it('falls back to catalogue search after network failure but propagates HTTP errors', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(failure());
    expect(await store.matches('rice')).toHaveLength(1);
    store.setConnection(true);
    vi.mocked(api.get).mockRejectedValueOnce(failure(403));
    await expect(store.matches('rice')).rejects.toBeInstanceOf(AxiosError);
});
it('explains unavailable or expired offline catalogue before collecting cash', async () => {
    store.setConnection(false);
    await expect(store.product('unknown')).rejects.toThrow(
        'not in the offline',
    );
    store.state!.lease!.expiresAt = new Date(0).toISOString();
    await expect(store.product(product().EAN)).rejects.toThrow('expired');
    expect(await store.matches('rice')).toEqual([]);
});
it('durably queues a weighed receipt before clearing the basket and replays the same local key', async () => {
    const receipt = await store.queue(body(), items());
    expect(receipt).toMatchObject({
        totalAmount: 8100,
        amountTendered: 10000,
        changeGiven: 1900,
        items: [{ unit: UnitOfMeasure.KG, quantity: 450 }],
    });
    expect(await store.hasQueued(body().idempotencyKey)).toBe(true);
    expect(store.pending).toHaveLength(1);
    expect(await store.queue(body(), items())).toEqual(receipt);
    expect(await pendingOffline(USER)).toHaveLength(1);
});
it.each([
    'discount',
    'gcash',
    'split',
    'two-tenders',
    'wrong-tender',
    'underpaid',
    'changed-price',
    'changed-unit',
    'missing-product',
])('refuses %s offline checkout', async (mode) => {
    const request = body();
    const cart = items();
    if (mode === 'discount')
        request.discount = {
            type: 'FIXED' as never,
            value: 100,
            reason: 'not allowed',
        };
    if (mode === 'gcash') request.paymentType = PaymentType.GCASH;
    if (mode === 'split') request.paymentType = PaymentType.SPLIT;
    if (mode === 'two-tenders') request.tenders.push(request.tenders[0]!);
    if (mode === 'wrong-tender') request.tenders[0]!.type = TenderType.GCASH;
    if (mode === 'underpaid') request.tenders[0]!.amount = 1;
    if (mode === 'changed-price') cart[0]!.unitPrice++;
    if (mode === 'changed-unit') cart[0]!.unit = UnitOfMeasure.L;
    if (mode === 'missing-product') request.sellDetails[0]!.product = 'missing';
    await expect(store.queue(request, cart)).rejects.toBeInstanceOf(Error);
    expect(await pendingOffline(USER)).toEqual([]);
});
it('does not return a receipt to a new cashier if logout interrupts the durable write', async () => {
    const work = store.queue(body(), items());
    store.reset();
    await expect(work).rejects.toThrow('cashier changed');
    expect(await pendingOffline(USER)).toHaveLength(1);
    expect(store.pending).toEqual([]);
});
it('refuses checkout after logout or loss of prepared lease', async () => {
    store.reset();
    await expect(store.queue(body(), items())).rejects.toThrow('Log in');
    await store.restore('unprepared', [Role.Seller]);
    await expect(store.queue(body(), items())).rejects.toThrow('not prepared');
});
it('syncs a lost-response key once and removes only after server confirmation', async () => {
    await store.queue(body(), items());
    await Promise.all([store.sync(), store.sync()]);
    expect(
        vi
            .mocked(api.post)
            .mock.calls.filter(([path]) => path === '/offline/sync'),
    ).toHaveLength(1);
    expect(await pendingOffline(USER)).toEqual([]);
});
it('keeps cash records on network failure and retries the original request on reconnect', async () => {
    await store.queue(body(), items());
    vi.mocked(api.post).mockRejectedValueOnce(failure());
    await store.sync();
    expect(await pendingOffline(USER)).toHaveLength(1);
    expect(store.offline).toBe(true);
    store.setConnection(true);
    vi.mocked(api.post).mockImplementation(acknowledged);
    await store.sync();
    expect(await pendingOffline(USER)).toEqual([]);
});
it.each([
    ErrorCode.OFFLINE_RECONCILIATION_REQUIRED,
    ErrorCode.OFFLINE_INVALID,
    ErrorCode.SALE_IDEMPOTENCY_MISMATCH,
])(
    'keeps blocked %s receipt for explicit admin reconciliation',
    async (error) => {
        await store.queue(body(), items());
        vi.mocked(api.post).mockRejectedValue(failure(409, error));
        await store.sync();
        expect(store.pending[0]?.blocked).toContain('Ask admin');
        await store.sync();
        expect(api.post).toHaveBeenCalledTimes(1);
    },
);
it('keeps transient HTTP failures retryable rather than discarding cash', async () => {
    await store.queue(body(), items());
    vi.mocked(api.post).mockRejectedValue(failure(500));
    await store.sync();
    expect(store.pending[0]?.blocked).toBeUndefined();
    expect(store.error).toContain('Ask admin');
});
it('refuses reconciliation without admin authority and a nonblank reason', async () => {
    await store.queue(body(), items());
    await expect(
        store.reconcileEntry(store.pending[0]!, 'counted'),
    ).rejects.toThrow('admin');
    store.admin = true;
    await expect(store.reconcileEntry(store.pending[0]!, '  ')).rejects.toThrow(
        'reason',
    );
});
it('drains and suspends offline mode before releasing the exact terminal lease', async () => {
    await store.queue(body(), items());
    await store.beforeClose();
    expect(await pendingOffline(USER)).toEqual([]);
    expect(api.post).toHaveBeenLastCalledWith(
        `/offline/leases/${LEASE}/release`,
        { terminalId: 'terminal' },
    );
    expect((await readOfflineState(USER))?.suspended).toBe(true);
});
it('keeps shift open while offline or with a blocked collected sale', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(failure());
    await expect(store.beforeClose()).rejects.toThrow('Reconnect');
    store.setConnection(true);
    await store.queue(body(), items());
    vi.mocked(api.post).mockRejectedValue(
        failure(409, ErrorCode.OFFLINE_RECONCILIATION_REQUIRED),
    );
    await expect(store.beforeClose()).rejects.toThrow('pending cash');
});
it('does not require storage for a normal online shift that never issued a lease', async () => {
    store.reset();
    await expect(store.beforeClose()).resolves.toBeUndefined();
});
it('does not expose an old cashier’s late sync failure after logout', async () => {
    await store.queue(body(), items());
    let reject: ((reason: unknown) => void) | undefined;
    vi.mocked(api.post).mockImplementation(
        () =>
            new Promise((_resolve, fail) => {
                reject = fail;
            }),
    );
    const work = store.sync();
    await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
    store.reset();
    reject!(failure(409, ErrorCode.OFFLINE_RECONCILIATION_REQUIRED));
    await work;
    expect(store.error).toBe('');
    expect(store.pending).toEqual([]);
    expect(await pendingOffline(USER)).toHaveLength(1);
});

it('atomically prepares one durable terminal identity across fresh tabs', async () => {
    closeOfflineDatabase();
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    const a = useOfflineStore(createPinia());
    const b = useOfflineStore(createPinia());
    await Promise.all([
        a.restore(USER, [Role.Seller]),
        b.restore(USER, [Role.Seller]),
    ]);
    const terminals = new Set<string>();
    vi.mocked(api.post).mockImplementation(async (path, data: unknown) => {
        if (path === '/offline/lease') {
            const terminal = (data as { terminalId: string }).terminalId;
            expect((await readOfflineState(USER))?.terminalId).toBe(terminal);
            terminals.add(terminal);
            return { data: lease() };
        }
        return { data: {} };
    });
    await Promise.all([a.prepare(lease().shift), b.prepare(lease().shift)]);
    expect(terminals.size).toBe(1);
    expect(a.state?.terminalId).toBe(b.state?.terminalId);
    await a.beforeClose();
    expect(api.post).toHaveBeenLastCalledWith(
        `/offline/leases/${LEASE}/release`,
        {
            terminalId: (await readOfflineState(USER))?.terminalId,
        },
    );
});
it('reuses committed terminal identity after a lost first lease response and reload', async () => {
    closeOfflineDatabase();
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    const a = useOfflineStore(createPinia());
    await a.restore(USER, [Role.Seller]);
    vi.mocked(api.post).mockRejectedValueOnce(failure());
    await a.prepare(lease().shift);
    const first = (await readOfflineState(USER))!;
    expect(first.lease).toBeNull();
    closeOfflineDatabase();
    const b = useOfflineStore(createPinia());
    await b.restore(USER, [Role.Seller]);
    await b.prepare(lease().shift);
    expect(api.post).toHaveBeenNthCalledWith(1, '/offline/lease', {
        terminalId: first.terminalId,
    });
    expect(api.post).toHaveBeenNthCalledWith(2, '/offline/lease', {
        terminalId: first.terminalId,
    });
    expect(b.state?.lease?._id).toBe(LEASE);
});

it('applies archived tombstones without losing pending cash receipts', async () => {
    await store.queue(body(), items());
    vi.mocked(api.get).mockResolvedValue({
        data: {
            products: [{ ...product(), isActive: false, proof: '' }],
            next: null,
        },
    });
    await store.prepare(lease().shift);
    expect(store.state?.products).toEqual([]);
    expect(store.state?.cursor).not.toBeNull();
});

it('looks up present and absent receipt keys directly without listing the outbox', async () => {
    await store.queue(body(), items());
    const get = vi.spyOn(IDBObjectStore.prototype, 'get');
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    expect(await store.hasQueued(body().idempotencyKey)).toBe(true);
    expect(await store.hasQueued('absent')).toBe(false);
    expect(getAll).not.toHaveBeenCalled();
    expect(get.mock.calls).toEqual([
        [[USER, body().idempotencyKey]],
        [[USER, 'absent']],
    ]);
    await store.restore('another', [Role.Seller]);
    getAll.mockClear();
    expect(await store.hasQueued(body().idempotencyKey)).toBe(false);
    expect(getAll).not.toHaveBeenCalled();
});
it('replays a queued receipt through its compound key without a full outbox read', async () => {
    const receipt = await store.queue(body(), items());
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    expect(await store.queue(body(), items())).toEqual(receipt);
    expect(getAll).not.toHaveBeenCalled();
});

it('does not look up a receipt under a placeholder owner after logout', async () => {
    store.reset();
    const get = vi.spyOn(IDBObjectStore.prototype, 'get');
    expect(await store.hasQueued('any')).toBe(false);
    expect(get).not.toHaveBeenCalled();
});

it('persists each catalogue product once across pages instead of rewriting accumulated products', async () => {
    const saved = (await readOfflineState(USER))!;
    await saveOfflineState({ ...saved, products: [] });
    const products = Array.from({ length: 10000 }, (_, i) => ({
        ...product(),
        _id: `product-${i}`,
        EAN: `barcode-${i}`,
    }));
    vi.mocked(api.get).mockImplementation(async (_path, options) => {
        const after = (options?.params as { after?: string }).after;
        const offset = after ? Number(after) : 0;
        return {
            data: {
                products: products.slice(offset, offset + 100),
                next:
                    offset + 100 < products.length
                        ? String(offset + 100)
                        : null,
            },
        };
    });
    const writes = vi.spyOn(IDBObjectStore.prototype, 'put');
    const reads = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    await store.prepare(lease().shift);
    let persistedProducts = 0;
    for (let i = 0; i < writes.mock.calls.length; i++) {
        const value = writes.mock.calls[i]![0] as {
            products?: OfflineProduct[];
        };
        persistedProducts +=
            (writes.mock.contexts[i] as IDBObjectStore | undefined)?.name ===
            'catalogue'
                ? 1
                : (value.products?.length ?? 0);
    }
    expect(store.state?.products).toHaveLength(10000);
    expect(persistedProducts).toBe(10000);
    expect(
        reads.mock.contexts.filter(
            (context) => (context as IDBObjectStore).name === 'catalogue',
        ),
    ).toHaveLength(1);
});

it.each(['successful', 'aborted-once'])(
    'upgrades %s legacy queued cash without changing signed proofs and syncs the exact original request',
    async (mode) => {
        const receipt = await store.queue(body(), items());
        const collected = (await pendingOffline(USER))[0]!;
        const snapshot = (await readOfflineState(USER))!;
        store.reset();
        closeOfflineDatabase();
        vi.stubGlobal('indexedDB', new IDBFactory());
        const blocked = {
            ...collected,
            owner: 'other-cashier',
            blocked: 'Cash counted; needs admin',
            request: { ...collected.request, idempotencyKey: 'other-key' },
        };
        await seedLegacyOfflineDatabase([snapshot], [collected, blocked]);
        if (mode === 'aborted-once') {
            const original = IDBObjectStore.prototype.put;
            const writes = vi
                .spyOn(IDBObjectStore.prototype, 'put')
                .mockImplementation(function (
                    this: IDBObjectStore,
                    value: unknown,
                    key?: IDBValidKey,
                ) {
                    const request = original.call(this, value, key);
                    if (this.name === 'catalogue')
                        request.onsuccess = () => this.transaction.abort();
                    return request;
                });
            expect(await store.restore(USER, [Role.Seller])).toBeNull();
            expect(store.error).not.toBe('');
            writes.mockRestore();
        }
        expect(await store.restore(USER, [Role.Seller])).toEqual(
            snapshot.lease!.shift,
        );
        expect(await pendingOffline(USER)).toEqual([collected]);
        expect(store.pending[0]?.receipt).toEqual(receipt);
        vi.mocked(api.post).mockClear();
        await store.sync();
        expect(api.post).toHaveBeenCalledWith(
            '/offline/sync',
            collected.request,
        );
        expect(await pendingOffline(USER)).toEqual([]);
        expect(await pendingOffline()).toEqual([blocked]);
    },
);

it('resumes an interrupted catalogue from the committed page after reopening storage', async () => {
    const next = { ...product(), _id: 'next-product', EAN: 'other-barcode' };
    vi.mocked(api.get)
        .mockResolvedValueOnce({
            data: { products: [next], next: 'resume-cursor' },
        })
        .mockRejectedValueOnce(failure());
    await store.prepare(lease().shift);
    expect((await readOfflineState(USER))?.cursor).toBe('resume-cursor');
    closeOfflineDatabase();
    await store.restore(USER, [Role.Seller]);
    vi.mocked(api.get).mockClear();
    vi.mocked(api.get).mockResolvedValueOnce({
        data: { products: [], next: null },
    });
    await store.prepare(lease().shift);
    expect(api.get).toHaveBeenCalledWith('/offline/catalog', {
        params: { lease: LEASE, after: 'resume-cursor' },
    });
    expect(store.state?.products).toHaveLength(2);
    expect(store.state?.products.find((p) => p._id === next._id)).toEqual(next);
    expect(store.ready).toBe(true);
});

it('hides an old catalogue immediately on lease change even if the new page loses the network', async () => {
    await store.queue(body(), items());
    const collected = (await pendingOffline(USER))[0]!;
    vi.mocked(api.post).mockResolvedValueOnce({
        data: { ...lease(), _id: 'new-lease' },
    });
    vi.mocked(api.get).mockRejectedValueOnce(failure());
    await store.prepare(lease().shift);
    expect(store.ready).toBe(false);
    expect(store.state?.products).toEqual([]);
    expect((await readOfflineState(USER))?.products).toEqual([]);
    expect(await pendingOffline(USER)).toEqual([collected]);
});

it('does not apply an old cashier catalogue response after logout', async () => {
    let finish:
        | ((value: {
              data: { products: OfflineProduct[]; next: null };
          }) => void)
        | undefined;
    vi.mocked(api.get).mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    const work = store.prepare(lease().shift);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    store.reset();
    finish!({
        data: { products: [{ ...product(), price: 99000 }], next: null },
    });
    await work;
    expect(store.state).toBeNull();
    expect((await readOfflineState(USER))?.products[0]?.price).toBe(18000);
});
it('uses the reachable API while the browser reports no internet (#359)', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    setActivePinia(createPinia());
    store = useOfflineStore();
    await store.restore(USER, [Role.Seller]);
    expect(store.connected).toBe(true);
    vi.mocked(api.get).mockResolvedValueOnce({
        data: { ...product(), price: 20000 },
    });
    expect((await store.product(product().EAN)).price).toBe(20000);
    vi.mocked(api.get).mockResolvedValueOnce({ data: [] });
    expect(await store.matches('rice')).toEqual([]);
    await store.prepare(lease().shift);
    expect(api.post).toHaveBeenCalledWith('/offline/lease', {
        terminalId: 'terminal',
    });
    await store.queue(body(), items());
    await store.sync();
    expect(await pendingOffline(USER)).toEqual([]);
    await store.beforeClose();
    expect(api.post).toHaveBeenLastCalledWith(
        `/offline/leases/${LEASE}/release`,
        { terminalId: 'terminal' },
    );
});
it('probes only the configured API, bounded, and classifies its answers', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: {} });
    expect(await store.probe()).toBe(true);
    expect(api.get).toHaveBeenLastCalledWith('/health/live', {
        timeout: PROBE_TIMEOUT_MS,
    });
    for (const [cause, reachable] of [
        [failure(), false],
        [failure(502), false],
        [failure(503), false],
        [failure(504), false],
        [failure(500), true],
        [failure(401), true],
        [new Error('boom'), false],
    ] as const) {
        vi.mocked(api.get).mockRejectedValueOnce(cause);
        expect(await store.probe()).toBe(reachable);
        expect(store.connected).toBe(reachable);
    }
});
it('shares one probe at a time and recovers after an API restart', async () => {
    store.setConnection(false);
    let answer: (v: { data: object }) => void = () => undefined;
    vi.mocked(api.get).mockReturnValueOnce(
        new Promise((resolve) => (answer = resolve)),
    );
    const first = store.probe();
    const second = store.probe();
    answer({ data: {} });
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(store.connected).toBe(true);
    expect(api.get).toHaveBeenCalledTimes(1);
});
it('ignores a probe answer that arrives after logout', async () => {
    let answer: (v: unknown) => void = () => undefined;
    vi.mocked(api.get).mockReturnValueOnce(
        new Promise((_, reject) => (answer = reject)),
    );
    const late = store.probe();
    store.reset();
    answer(failure());
    expect(await late).toBe(false);
    expect(store.connected).toBe(true);
});
