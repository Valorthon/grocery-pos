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
import {
    field,
    fieldError,
    flush,
    pickFirstMatch,
    type,
} from '@/testing/form-dom';
import { SEARCH_DEBOUNCE_MS } from '@/composables/useProductMatches';
import { wedgeScan } from '@/testing/scanner';
import { anyModalOpen } from '@/components/ui/modal-stack';
import { AxiosError, AxiosHeaders } from 'axios';
import { ErrorCode } from '@grocery-pos/contracts';

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
        resolve: () => ({ meta: { roles: ['ADMIN', 'RESTOCKER'] } }),
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
    const button = [...document.querySelectorAll('button')].reverse().find(
        (b) =>
            b.textContent?.trim() === text ||
            // The trailing row-open icon is named by its aria-label (#243).
            b.getAttribute('aria-label')?.startsWith(`${text} `),
    );
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

    it('badges every status and opens from a 44px trailing icon (#243)', async () => {
        const all = Object.values(PurchaseOrderStatus).map((status, i) => ({
            ...order(status),
            _id: `po${i}`,
        }));
        const base = api.get.getMockImplementation()!;
        api.get.mockImplementation((url: string): Promise<unknown> =>
            url === '/purchase-orders'
                ? Promise.resolve({
                      data: { data: all, totalItems: all.length },
                  })
                : (base(url) as Promise<unknown>),
        );
        await mount();
        const badges = [
            ...document.querySelectorAll('[data-testid="po-status"]'),
        ];
        expect(badges.map((b) => [b.textContent?.trim(), b.className])).toEqual(
            [
                ['Draft', expect.stringContaining('bg-paper')],
                ['Sent', expect.stringContaining('bg-warning-bg')],
                [
                    'Partially received',
                    expect.stringContaining('bg-warning-bg'),
                ],
                ['Received', expect.stringContaining('bg-success-bg')],
                ['Cancelled', expect.stringContaining('bg-danger-bg')],
            ],
        );
        const open = document.querySelector<HTMLButtonElement>(
            '[data-testid="po-open"]',
        )!;
        expect(open.getAttribute('aria-label')).toBe('Open PO-PO0');
        expect(open.className).toContain('min-h-11');
        expect(open.className).toContain('min-w-11');
        expect(
            [...document.querySelectorAll('button')].some(
                (b) => b.textContent?.trim() === 'Open',
            ),
        ).toBe(false);
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

    it('opens an order from its row by click, Enter or Space (#234)', async () => {
        const receiveShown = () =>
            [...document.querySelectorAll('button')].some(
                (b) => b.textContent?.trim() === 'Receive',
            );
        await mount();
        const row = () =>
            document.querySelector<HTMLTableRowElement>('tbody tr')!;
        expect(row().tabIndex).toBe(0);
        expect(row().getAttribute('aria-describedby')).toBeTruthy();
        expect(document.body.textContent).toContain(
            'Press Enter to open the order',
        );
        expect(receiveShown()).toBe(false);
        row().querySelector('td')!.click();
        await flush();
        expect(receiveShown()).toBe(true);
        for (const key of ['Enter', ' ']) {
            app?.unmount();
            document.body.innerHTML = '';
            await mount();
            row().dispatchEvent(
                new KeyboardEvent('keydown', { key, bubbles: true }),
            );
            await flush();
            expect(receiveShown()).toBe(true);
        }
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
/** Taps a status chip (#261). */
async function chip(label: string) {
    const button = [
        ...document.querySelectorAll('[role=group][aria-label=Status] button'),
    ].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    button.click();
    await flush();
}
/** Opens Add product and picks milk (#284). */
async function pickMilk() {
    document
        .querySelector<HTMLButtonElement>('[data-testid="po-add-product"]')!
        .click();
    await flush();
    await type('Product (EAN or name)', 'milk');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await flush();
    await pickFirstMatch();
}
/** Adds milk through the dialog with `qty` L at ₱`cost`. */
async function addMilk(qty = '1.5', cost = '80') {
    await pickMilk();
    await type('Ordered', qty);
    await type('Expected cost', cost);
    await press('Add');
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
        await addMilk('1', '70');
        costs({ data: [{ product: 'p9' }] });
        await flush();
        // Picking milk again edits its line: no second line (#284).
        await pickMilk();
        expect(field('Ordered').value).toBe('1');
        expect(field('Expected cost').value).toBe('70');
        expect(document.body.textContent).toContain('Edit line');
        await type('Ordered', '');
        await press('Update');
        expect(fieldError('Ordered')).not.toBe('');
        await type('Ordered', '1.5');
        await type('Expected cost', '80');
        await press('Update');
        expect(
            document.querySelectorAll('input[aria-label^="Ordered quantity"]'),
        ).toHaveLength(1);
        expect(document.body.textContent).not.toContain('already on');
        const qty = input('Ordered quantity (L) for milk');
        expect(qty.value).toBe('1.5');
        qty.value = '';
        qty.dispatchEvent(new Event('input'));
        await press('Save draft');
        expect(document.body.textContent).toContain(
            'Fix the highlighted lines.',
        );
        qty.value = '1.5';
        qty.dispatchEvent(new Event('input'));
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
        expect(
            document.querySelector('[aria-label="Remove milk"]'),
        ).not.toBeNull();
        await press('Remove');
        expect(document.querySelector('[aria-label="Remove milk"]')).toBeNull();
        expect(
            document.querySelector('[data-testid="po-no-lines"]'),
        ).not.toBeNull();
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
        await chip('Sent');
        expect(
            document
                .querySelector('[aria-label=Status] [data-value=SENT]')!
                .getAttribute('aria-pressed'),
        ).toBe('true');
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

    it('offers every status as a chip and All sends no status with one request; no Clear (#261)', async () => {
        api.get.mockImplementation((url: string) =>
            url === '/purchase-orders'
                ? Promise.resolve({ data: { data: [order()], totalItems: 45 } })
                : Promise.resolve({ data: [] }),
        );
        await mount();
        expect(
            [
                ...document.querySelectorAll(
                    '[role=group][aria-label=Status] button',
                ),
            ].map((b) => b.textContent?.trim()),
        ).toEqual([
            'All',
            'Draft',
            'Sent',
            'Partially received',
            'Received',
            'Cancelled',
        ]);
        expect(
            [...document.querySelectorAll('label')].some((l) =>
                l.textContent?.includes('Status'),
            ),
        ).toBe(false);
        await chip('Sent');
        api.get.mockClear();

        expect(document.body.textContent).not.toContain('Clear Filters');
        await chip('All');

        expect(
            api.get.mock.calls.filter(([url]) => url === '/purchase-orders'),
        ).toEqual([['/purchase-orders', { params: { page: 1, limit: 10 } }]]);
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
        expect(
            document.querySelector('[data-testid="po-no-lines"]'),
        ).not.toBeNull();
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
        for (const title of [
            'Ordered',
            'Received',
            'Outstanding',
            'Expected cost',
        ]) {
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

describe('Purchase order scanning (#214)', () => {
    const products: Record<string, unknown> = {
        '4800000000017': {
            _id: 'p1',
            name: 'soap',
            EAN: '4800000000017',
            unit: UnitOfMeasure.PIECE,
        },
        '4800000000024': {
            _id: 'p2',
            name: 'rice',
            EAN: '4800000000024',
            unit: UnitOfMeasure.KG,
        },
    };
    function archived() {
        return new AxiosError('x', '400', undefined, undefined, {
            status: 400,
            statusText: '',
            headers: {},
            config: { headers: new AxiosHeaders() },
            data: {
                statusCode: 400,
                error: ErrorCode.VALIDATION_INVALID_INPUT,
                message: 'Product discontinued',
            },
        });
    }
    beforeEach(() => {
        const base = api.get.getMockImplementation()!;
        api.get.mockImplementation((url: string, config?: unknown) => {
            const code = url.startsWith('/products/') ? url.slice(10) : null;
            if (code === '4800000000031') return Promise.reject(archived());
            if (code === '4800000000048')
                return Promise.reject(
                    new AxiosError('x', '404', undefined, undefined, {
                        status: 404,
                        statusText: '',
                        headers: {},
                        config: { headers: new AxiosHeaders() },
                        data: {},
                    }),
                );
            if (code) return Promise.resolve({ data: products[code] });
            return base(url, config) as Promise<unknown>;
        });
    });

    const dialogOpen = () => anyModalOpen.value;
    const selectedProduct = () =>
        document
            .querySelector('[data-testid="combobox-selected"]')
            ?.textContent?.trim();

    it('opens the dialog for a new product, then counts a repeat up by one (#284)', async () => {
        await mount();
        await press('New purchase order');
        wedgeScan('4800000000017');
        await flush();
        expect(dialogOpen()).toBe(true);
        expect(selectedProduct()).toContain('soap');
        expect(api.get).toHaveBeenCalledWith('/suppliers/costs', {
            params: { products: 'p1' },
        });
        await type('Ordered', '1');
        await type('Expected cost', '5');
        await press('Add');
        expect(dialogOpen()).toBe(false);
        expect(input('Ordered quantity (pc) for soap').value).toBe('1');
        wedgeScan('4800000000017');
        await flush();
        expect(dialogOpen()).toBe(false);
        expect(input('Ordered quantity (pc) for soap').value).toBe('2');
        expect(
            document.querySelectorAll('input[aria-label^="Ordered quantity"]'),
        ).toHaveLength(1);
    });

    it('ignores a scan whose lookup answers while the dialog is open (#284)', async () => {
        await mount();
        await press('New purchase order');
        const base = api.get.getMockImplementation()!;
        const answers: (() => void)[] = [];
        api.get.mockImplementation((url: string, config?: unknown) =>
            url === '/products/4800000000017'
                ? new Promise((resolve) =>
                      answers.push(() =>
                          resolve({ data: products[url.slice(10)] }),
                      ),
                  )
                : (base(url, config) as Promise<unknown>),
        );
        wedgeScan('4800000000017');
        wedgeScan('4800000000017');
        await flush();
        while (answers.length) {
            answers.shift()!();
            await flush();
        }
        await flush();
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
        await type('Ordered', '3');
        await type('Expected cost', '5');
        await press('Add');
        expect(
            document.querySelectorAll('input[aria-label^="Ordered quantity"]'),
        ).toHaveLength(1);
        expect(input('Ordered quantity (pc) for soap').value).toBe('3');
        // A scan while the dialog is open is never captured.
        await press('Add product');
        api.get.mockClear();
        wedgeScan('4800000000024');
        await flush();
        expect(api.get).not.toHaveBeenCalledWith('/products/4800000000024');
    });

    it('focuses Ordered for a scanned measured product, and its line on a repeat', async () => {
        await mount();
        await press('New purchase order');
        wedgeScan('4800000000024');
        await flush();
        expect(document.activeElement).toBe(field('Ordered (kg)'));
        await type('Ordered', '2.5');
        await type('Expected cost', '50');
        await press('Add');
        const qty = input('Ordered quantity (kg) for rice');
        expect(qty.value).toBe('2.5');
        qty.blur();
        wedgeScan('4800000000024');
        await flush();
        expect(dialogOpen()).toBe(false);
        expect(qty.value).toBe('2.5');
        expect(document.activeElement).toBe(qty);
    });

    it('refuses an unknown code', async () => {
        await mount();
        await press('New purchase order');
        wedgeScan('4800000000048');
        await flush();
        expect(useUIStore().toasts[0]?.lines).toEqual(['Product not found']);
        expect(dialogOpen()).toBe(false);
    });

    it('refuses an archived product', async () => {
        await mount();
        await press('New purchase order');
        wedgeScan('4800000000031');
        await flush();
        expect(useUIStore().toasts[0]?.lines).toEqual(['Product archived']);
    });

    it('ignores scans outside a draft', async () => {
        await mount();
        wedgeScan('4800000000017');
        await flush();
        expect(api.get).not.toHaveBeenCalledWith('/products/4800000000017');
    });
});

describe('Purchase order editor layout and order view (#275)', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
        vi.useRealTimers();
    });
    const h1 = () => document.querySelector('h1')?.textContent?.trim();
    const header = () => document.querySelector('header')!;
    const headerButtons = () =>
        [...header().querySelectorAll('button')].map((b) =>
            b.textContent?.trim(),
        );
    const byId = (id: string) =>
        document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    function openWith(po: PurchaseOrderView) {
        api.get.mockImplementation((url: string) =>
            Promise.resolve(
                url === '/purchase-orders'
                    ? { data: { data: [po], totalItems: 1 } }
                    : { data: { data: [], totalItems: 0 } },
            ),
        );
    }

    it('titles a new draft, bands Supplier and Note, and shows an empty table with its total', async () => {
        await mount();
        await press('New purchase order');
        expect(h1()).toBe('New purchase order');
        expect(byId('po-title-status')).toBeNull();
        expect(headerButtons()).toEqual(['Back to list', 'Save draft']);
        const band = byId('po-top-band')!;
        expect(band.textContent).toContain('Supplier');
        expect(band.textContent).toContain('Note (optional)');
        expect(byId('po-lines-header')!.textContent).toContain('Lines');
        expect(byId('po-add-product')!.textContent).toContain('Add product');
        expect(byId('po-add-product')!.className).toContain('min-h-11');
        const heads = [...document.querySelectorAll('thead th')].map((th) =>
            th.textContent?.trim(),
        );
        expect(heads).toEqual([
            'Product',
            'Ordered',
            'Expected cost',
            'Line total',
            'Action',
        ]);
        expect(byId('po-no-lines')!.closest('tbody')).not.toBeNull();
        expect(byId('po-no-lines')!.textContent).toContain('No products yet');
        expect(byId('po-no-lines')!.textContent).toContain(
            'Scan a barcode or click Add product.',
        );
        expect(byId('po-no-lines')!.getAttribute('colspan')).toBe('5');
        // Both Add product buttons open the same dialog (#284).
        for (const id of ['po-add-product', 'po-empty-add']) {
            byId(id)!.click();
            await flush();
            expect(byId('po-line-dialog')).not.toBeNull();
            expect(document.body.textContent).toContain('Add product');
            await press('Cancel');
            expect(anyModalOpen.value).toBe(false);
        }
        // No inline add combobox: Add product is a button (#284).
        expect(byId('po-add-product')!.tagName).toBe('BUTTON');
        const foot = byId('po-expected-total')!;
        expect(foot.tagName).toBe('TFOOT');
        expect(foot.textContent).toContain('Expected total');
        expect(foot.textContent).toContain('₱0.00');
    });

    it("puts a saved draft's actions in the header", async () => {
        openWith(order(PurchaseOrderStatus.DRAFT));
        await mount();
        await press('Open');
        expect(h1()).toBe(purchaseOrderReference('po1'));
        expect(byId('po-title-status')!.textContent).toContain('Draft');
        expect(headerButtons()).toEqual([
            'Back to list',
            'Save draft',
            'Mark as sent',
            'Cancel order',
        ]);
        expect(byId('po-expected-total')!.textContent).toContain('₱3.00');
    });

    it('shows an open order with its heading, meta line, note and receipts link', async () => {
        openWith({ ...order(), note: 'Weekly run', receipts: ['r1'] });
        await mount();
        await press('Open');
        expect(h1()).toBe(purchaseOrderReference('po1'));
        expect(byId('po-title-status')!.textContent).toContain('Sent');
        expect(headerButtons()).toEqual([
            'Back to list',
            'Receive',
            'Cancel order',
        ]);
        expect(byId('details-heading')!.textContent).toContain('Farm');
        expect(byId('details-total')!.textContent).toContain('₱3.00');
        const meta = [...byId('details-meta')!.querySelectorAll('li')].map(
            (li) => li.textContent?.trim(),
        );
        expect(meta[0]).toMatch(/^Created Nov 6, 2026/);
        expect(meta.slice(1)).toEqual(['by restocker', 'View receipts']);
        expect(byId('details-note')!.textContent?.trim()).toBe(
            'Note: Weekly run',
        );
        expect(byId('po-top-band')).toBeNull();
        expect(byId('po-add-product')).toBeNull();
        expect(byId('po-lines-header')).toBeNull();
        expect(byId('po-expected-total')!.textContent).toContain('₱3.00');
        await press('View receipts');
        expect(nav.push).toHaveBeenCalledWith({
            name: 'Restocks',
            query: { purchaseOrder: 'po1' },
        });
    });

    it('leaves out the note and receipts link when there are none', async () => {
        openWith(order(PurchaseOrderStatus.RECEIVED));
        await mount();
        await press('Open');
        expect(headerButtons()).toEqual(['Back to list']);
        expect(byId('details-note')).toBeNull();
        expect(byId('details-meta')!.textContent).not.toContain(
            'View receipts',
        );
    });

    it('marks a cancelled order closed short, with no actions', async () => {
        openWith({
            ...order(PurchaseOrderStatus.CANCELLED),
            closedShort: true,
            receipts: ['r1'],
        });
        await mount();
        await press('Open');
        expect(byId('po-title-status')!.textContent).toContain('Cancelled');
        expect(headerButtons()).toEqual(['Back to list']);
        expect(byId('details-meta')!.textContent).toContain('Closed short');
    });

    it('totals a measured line exactly and puts Expected total under it', async () => {
        await mount();
        await press('New purchase order');
        await addMilk('0.45', '180');
        costs({ data: [] });
        await flush();
        const lineCell = () =>
            document.querySelector('[data-testid="po-line-total"]')!;
        const qty = input('Ordered quantity (L) for milk');
        qty.value = '';
        qty.dispatchEvent(new Event('input'));
        await flush();
        expect(lineCell().textContent?.trim()).toBe('—');
        qty.value = '0.45';
        qty.dispatchEvent(new Event('input'));
        await flush();
        expect(lineCell().textContent).toContain('₱81.00');
        const foot = document.querySelector('tfoot tr')!;
        const label = foot.querySelector('th')!;
        expect(label.getAttribute('colspan')).toBe('3');
        expect(foot.querySelectorAll('td')[0]!.textContent).toContain('₱81.00');
    });
});
