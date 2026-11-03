import { IDBFactory } from 'fake-indexeddb';
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
import { useOfflineStore } from './offline';
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
    store.setConnection(false);
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
