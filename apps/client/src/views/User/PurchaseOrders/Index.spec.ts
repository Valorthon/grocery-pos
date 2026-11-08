import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import {
    purchaseOrderReference,
    PurchaseOrderStatus,
    Role,
    UnitOfMeasure,
    type InventoryRow,
    type PurchaseOrderView,
} from '@grocery-pos/contracts';
import Index from './Index.vue';
import { useAuthStore } from '@/stores/auth';
import { useUIStore } from '@/stores/ui';
import { usePurchaseOrderPrefillStore } from '@/stores/purchaseOrderPrefill';
import { field, flush, pickFirstMatch, type } from '@/testing/form-dom';
import { SEARCH_DEBOUNCE_MS } from '@/composables/useProductMatches';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
const nav = vi.hoisted(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    route: { value: { query: {} as Record<string, string> } },
}));
vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal<typeof import('vue-router')>()),
    onBeforeRouteLeave: vi.fn(),
    useRouter: () => ({
        push: nav.push,
        replace: nav.replace,
        currentRoute: nav.route,
    }),
}));

function order(status = PurchaseOrderStatus.SENT): PurchaseOrderView {
    return {
        _id: 'po1',
        supplier: { _id: 's1', name: 'Farm', isActive: false },
        status,
        version: 1,
        createdBy: { _id: 'u', name: 'restocker' },
        closedShort: false,
        receipts: [],
        expectedTotal: 300,
        createdAt: '2026-11-06T00:00:00.000Z',
        updatedAt: '2026-11-06T00:00:00.000Z',
        lines: [
            {
                _id: 'l1',
                product: 'p1',
                name: 'soap',
                EAN: '4800000000017',
                unit: UnitOfMeasure.PIECE,
                tracksExpiry: false,
                productActive: true,
                orderedQty: 3,
                receivedQty: 0,
                outstandingQty: 3,
                expectedCost: 100,
            },
        ],
    };
}
let app: App | undefined;
let costs: (value: unknown) => void;
async function mount() {
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(Index);
    app.mount(host);
    await flush();
}
async function press(text: string) {
    const button = [...document.querySelectorAll('button')]
        .reverse()
        .find((b) => b.textContent?.trim() === text);
    if (!button) throw new Error(`No button ${text}`);
    button.click();
    await flush();
}
function input(label: string) {
    return document.querySelector<HTMLInputElement>(
        `input[aria-label^="${label}"]`,
    )!;
}
beforeEach(() => {
    vi.clearAllMocks();
    document.cookie = 'dummy=1; path=/';
    setActivePinia(createPinia());
    nav.route.value = { query: {} };
    useAuthStore().user = {
        userId: 'u',
        username: 'restocker',
        roles: [Role.Restocker],
    };
    api.get.mockImplementation((url: string) => {
        if (url === '/purchase-orders')
            return Promise.resolve({
                data: { data: [order()], totalItems: 1 },
            });
        if (url === '/suppliers')
            return Promise.resolve({
                data: {
                    data: [{ _id: 's1', name: 'Farm', isActive: true }],
                    totalItems: 1,
                },
            });
        if (url === 'products/matches')
            return Promise.resolve({
                data: [
                    {
                        product: 'p9',
                        name: 'milk',
                        EAN: '4800000000099',
                        unit: UnitOfMeasure.L,
                    },
                ],
            });
        if (url === '/suppliers/costs')
            return new Promise((resolve) => {
                costs = resolve;
            });
        return Promise.resolve({ data: order() });
    });
});
afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = '';
});

describe('Purchase orders page (#123)', () => {
    it('lists orders, naming an archived supplier', async () => {
        await mount();
        expect(document.body.textContent).toContain('Farm (archived)');
        expect(document.body.textContent).toContain('Sent');
    });

    it('takes the low-stock handoff and fills known costs without overwriting edits', async () => {
        const prefill = usePurchaseOrderPrefillStore();
        prefill.prepare([
            {
                product: {
                    _id: 'p1',
                    name: 'soap',
                    EAN: '1',
                    reorderQuantity: 6,
                },
            },
            {
                product: {
                    _id: 'p2',
                    name: 'rice',
                    EAN: '2',
                    reorderQuantity: 2,
                },
            },
        ] as InventoryRow[]);
        await mount();
        const first = input('Expected unit cost (₱/pc) for soap');
        first.value = '9.99';
        first.dispatchEvent(new Event('input'));
        await flush();
        costs({
            data: [
                { product: 'p1', lastCost: 500 },
                { product: 'p2', lastCost: 700 },
            ],
        });
        await flush();
        expect(input('Expected unit cost (₱/pc) for soap').value).toBe('9.99');
        expect(input('Expected unit cost (₱/pc) for rice').value).toBe('7.00');
        expect(prefill.take()).toEqual([]);
        await press('Save draft');
        expect(api.post).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain(
            'Choose an active supplier.',
        );
    });

    it('reuses the key only for an unchanged body and reloads after a 409', async () => {
        await mount();
        await press('Open');
        await press('Receive');
        type Sent = { idempotencyKey: string; lines: unknown[] };
        const sent = (n: number) =>
            (api.post.mock.calls[n] as [string, Sent])[1];
        api.post.mockRejectedValueOnce(new Error('Network Error'));
        await press('Record receipt');
        api.post.mockRejectedValueOnce(new Error('Network Error'));
        await press('Record receipt');
        expect(sent(1).idempotencyKey).toBe(sent(0).idempotencyKey);
        await type('Actual unit cost', '1.10');
        api.post.mockRejectedValueOnce(new Error('Network Error'));
        await press('Record receipt');
        expect(sent(2).idempotencyKey).not.toBe(sent(0).idempotencyKey);
        api.get.mockClear();
        api.post.mockRejectedValueOnce({
            isAxiosError: true,
            response: {
                status: 409,
                data: {
                    statusCode: 409,
                    error: 'CONFLICT_001',
                    message: 'Purchase order changed.',
                    timestamp: '',
                    path: '',
                    details: null,
                    requestId: 'r',
                },
            },
        });
        await press('Record receipt');
        expect(api.get).toHaveBeenCalledWith('/purchase-orders/po1');
        expect(document.body.textContent).not.toContain('Record receipt');
        expect(useUIStore().toasts.flatMap((t) => t.lines)).toContain(
            'Purchase order reloaded. The receipt you entered was not recorded; enter it again.',
        );
        await press('Receive');
        api.post.mockResolvedValueOnce({
            data: { ...order(), status: PurchaseOrderStatus.RECEIVED },
        });
        await press('Record receipt');
        const [url, last] = api.post.mock.calls[4] as [string, Sent];
        expect(url).toBe('/purchase-orders/po1/receive');
        expect(last.idempotencyKey).not.toBe(sent(2).idempotencyKey);
        expect(last.lines).toEqual([
            { line: 'l1', quantity: 3, unitCost: 100 },
        ]);
        expect(document.body.textContent).toContain('Received');
    });

    it('asks before recording a ₱0 receipt line', async () => {
        await mount();
        await press('Open');
        await press('Receive');
        await type('Actual unit cost', '0');
        await press('Record receipt');
        expect(document.body.textContent).toContain('Record at ₱0 cost?');
        await press('Go back');
        expect(api.post).not.toHaveBeenCalled();
    });
});

async function choose(label: string, value: string) {
    const select = [...document.querySelectorAll('label')]
        .find((l) => l.textContent?.includes(label))!
        .parentElement!.querySelector('select')!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await flush();
}
async function addMilk() {
    await type('Add product', 'milk');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await flush();
    await pickFirstMatch();
}

describe('Purchase order drafting (#123)', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('creates, edits, sends and cancels a draft', async () => {
        await mount();
        await press('New purchase order');
        await press('Save draft');
        expect(document.body.textContent).toContain(
            'Choose an active supplier.',
        );
        await choose('Supplier', 's1');
        await press('Save draft');
        expect(document.body.textContent).toContain(
            'Add at least one product.',
        );
        await addMilk();
        costs({ data: [{ product: 'p9' }] });
        await flush();
        await addMilk();
        expect(document.body.textContent).toContain(
            'milk is already on this order.',
        );
        await press('Save draft');
        expect(document.body.textContent).toContain(
            'Fix the highlighted lines.',
        );
        const qty = input('Ordered quantity (L) for milk');
        qty.value = '1.5';
        qty.dispatchEvent(new Event('input'));
        const cost = input('Expected unit cost (₱/L) for milk');
        cost.value = '80';
        cost.dispatchEvent(new Event('input'));
        await type('Note', ' weekly ');
        const created = { ...order(PurchaseOrderStatus.DRAFT), version: 0 };
        api.post.mockResolvedValueOnce({ data: created });
        await press('Save draft');
        expect(api.post).toHaveBeenCalledWith('/purchase-orders', {
            supplier: 's1',
            note: 'weekly',
            lines: [{ product: 'p9', orderedQty: 1500, expectedCost: 8000 }],
        });
        const edit = input('Ordered quantity (pc) for soap');
        edit.value = '4';
        edit.dispatchEvent(new Event('input'));
        await flush();
        expect(document.body.textContent).toContain(
            'Save the draft before marking it as sent.',
        );
        api.patch.mockResolvedValueOnce({ data: { ...created, version: 1 } });
        await press('Save draft');
        expect(api.patch.mock.calls[0]?.[0]).toBe('/purchase-orders/po1');
        expect(api.patch.mock.calls[0]?.[1]).toMatchObject({ version: 0 });
        api.post.mockResolvedValueOnce({ data: order() });
        await press('Mark as sent');
        await press('Mark as sent');
        expect(api.post).toHaveBeenLastCalledWith('/purchase-orders/po1/send', {
            version: 1,
        });
        expect(document.body.textContent).toContain('Receive');
        api.post.mockRejectedValueOnce(new Error('Network Error'));
        await press('Cancel order');
        await press('Cancel order');
        expect(api.post).toHaveBeenLastCalledWith(
            '/purchase-orders/po1/cancel',
            { version: 1 },
        );
    });

    it('asks before discarding an unsaved draft and reloads the list', async () => {
        await mount();
        await press('New purchase order');
        await addMilk();
        await press('Remove');
        expect(document.body.textContent).not.toContain('milk (');
        await addMilk();
        await press('Back to list');
        expect(document.body.textContent).toContain('Discard changes?');
        await press('Discard');
        expect(document.body.textContent).toContain('New purchase order');
    });
});

describe('Purchase order list and receipts (#123)', () => {
    it('filters by status, pages and retries a failed load', async () => {
        api.get.mockImplementation((url: string) =>
            url === '/purchase-orders'
                ? Promise.resolve({ data: { data: [order()], totalItems: 45 } })
                : Promise.resolve({ data: [] }),
        );
        await mount();
        await press('Next');
        expect(api.get).toHaveBeenLastCalledWith('/purchase-orders', {
            params: { page: 2, limit: 10 },
        });
        await choose('Status', PurchaseOrderStatus.SENT);
        expect(api.get).toHaveBeenLastCalledWith('/purchase-orders', {
            params: { page: 1, limit: 10, status: PurchaseOrderStatus.SENT },
        });
        api.get.mockRejectedValueOnce(new Error('down'));
        await press('Next');
        expect(document.body.textContent).toContain(
            'Unable to load purchase orders.',
        );
        await press('Retry');
        expect(api.get).toHaveBeenLastCalledWith('/purchase-orders', {
            params: { page: 2, limit: 10, status: PurchaseOrderStatus.SENT },
        });
        expect(document.body.textContent).not.toContain(
            'Unable to load purchase orders.',
        );
    });

    it('validates receipt lines before posting', async () => {
        await mount();
        await press('Open');
        await press('Receive');
        await type('Received (pc)', '4');
        await press('Record receipt');
        expect(document.body.textContent).toContain('At most 3 outstanding');
        await type('Received (pc)', '');
        await press('Record receipt');
        expect(document.body.textContent).toContain(
            'Enter a received quantity on at least one line.',
        );
        await type('Received (pc)', '1');
        await type('Actual unit cost', '1.50');
        expect(document.body.textContent).toContain('variance +₱0.50');
        await type('Actual unit cost', 'x');
        expect(document.body.textContent).toContain('enter the actual cost');
        expect(field('Received (pc)').value).toBe('1');
        expect(api.post).not.toHaveBeenCalled();
    });
});

describe('Purchase order references and draft warnings (#123)', () => {
    const ID = '507f1f77bcf86cd799439abc';
    function archivedDraft(): PurchaseOrderView {
        const po = { ...order(PurchaseOrderStatus.DRAFT), _id: ID };
        po.lines = [{ ...po.lines[0]!, productActive: false }];
        return po;
    }
    it('warns on an archived supplier or product in the list and editor', async () => {
        api.get.mockImplementation((url: string) =>
            Promise.resolve(
                url === '/purchase-orders'
                    ? { data: { data: [archivedDraft()], totalItems: 1 } }
                    : { data: { data: [], totalItems: 0 } },
            ),
        );
        await mount();
        expect(document.body.textContent).toContain('PO-99439ABC');
        expect(document.body.textContent).toContain(
            'Needs review before sending',
        );
        await press('Open');
        expect(document.body.textContent).toContain(
            "This draft can't be sent as it stands.",
        );
        expect(document.body.textContent).toContain(
            'Supplier Farm is archived.',
        );
        expect(document.body.textContent).toContain('Archived product: soap.');
    });
    it('draws the editor with a breadcrumb and the shared draft table (#173)', async () => {
        const crumbs = () =>
            document.querySelector('nav[aria-label="Breadcrumb"]')
                ? [
                      ...document.querySelectorAll(
                          'nav[aria-label="Breadcrumb"] li',
                      ),
                  ]
                      .map((li) => li.textContent?.trim())
                      .join(' › ')
                : undefined;
        await mount();
        expect(crumbs()).toBeUndefined();
        await press('New purchase order');
        expect(crumbs()).toBe('Purchase orders › New purchase order');
        expect(document.querySelector('table')).toBeNull();
        expect(document.body.textContent).toContain('No lines yet');
        await press('Back to list');
        await press('Open');
        expect(crumbs()).toBe(
            `Purchase orders › ${purchaseOrderReference('po1')}`,
        );
        const heads = [...document.querySelectorAll('thead th')];
        // The list's table is gone while the editor shows.
        const cells = document
            .querySelector('tbody tr')!
            .querySelectorAll('td');
        for (const title of ['Ordered', 'Received', 'Outstanding']) {
            const i = heads.findIndex((th) => th.textContent?.trim() === title);
            expect(heads[i].className).toContain('text-right');
            expect(cells[i].classList.contains('num')).toBe(true);
            expect(cells[i].classList.contains('text-right')).toBe(true);
        }
    });
    it('writes the open order to ?id= and clears it on close (#143)', async () => {
        nav.route.value = { query: { status: 'SENT' } };
        await mount();
        await press('Open');
        expect(nav.replace).toHaveBeenCalledTimes(1);
        expect(nav.replace).toHaveBeenLastCalledWith({
            query: { status: 'SENT', id: 'po1' },
        });
        nav.route.value = { query: { status: 'SENT', id: 'po1' } };
        await press('Back to list');
        expect(nav.replace).toHaveBeenLastCalledWith({
            query: { status: 'SENT' },
        });
        expect(nav.push).not.toHaveBeenCalled();
    });
    it('opens a deep-linked order and links to its receipts', async () => {
        nav.route.value = { query: { id: ID } };
        api.get.mockImplementation((url: string) =>
            Promise.resolve(
                url === '/purchase-orders'
                    ? { data: { data: [], totalItems: 0 } }
                    : { data: { ...order(), _id: ID, receipts: ['r1'] } },
            ),
        );
        await mount();
        expect(api.get).toHaveBeenCalledWith(`/purchase-orders/${ID}`);
        // Already in the address: nothing is rewritten.
        expect(nav.replace).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('PO-99439ABC');
        await press('View receipts');
        expect(nav.push).toHaveBeenCalledWith({
            name: 'Restocks',
            query: { purchaseOrder: ID },
        });
    });
});
