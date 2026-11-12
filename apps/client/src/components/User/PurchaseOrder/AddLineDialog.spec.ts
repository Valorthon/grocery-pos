import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, ref, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { UnitOfMeasure, type ProductView } from '@grocery-pos/contracts';
import AddLineDialog from './AddLineDialog.vue';
import {
    PURCHASE_ORDER_HELP,
    type PurchaseOrderDraftLine,
} from './purchase-order';
import {
    field,
    fieldError,
    flush,
    pickFirstMatch,
    type,
} from '@/testing/form-dom';
import { SEARCH_DEBOUNCE_MS } from '@/composables/useProductMatches';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

let app: App | undefined;
let costs: (value: unknown) => void;
const open = ref(false);
const saved: PurchaseOrderDraftLine[] = [];

function mount(
    lines: PurchaseOrderDraftLine[] = [],
    scanned: ProductView | null = null,
) {
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(
        defineComponent(() => () => [
            h('button', { type: 'button' }, 'opener'),
            h(AddLineDialog, {
                modelValue: open.value,
                lines,
                scanned,
                'onUpdate:modelValue': (v: boolean) => (open.value = v),
                onSave: (line: PurchaseOrderDraftLine) => saved.push(line),
            }),
        ]),
    );
    app.use(createPinia());
    app.mount(host);
}
async function show() {
    open.value = true;
    await flush();
}
async function pickMilk() {
    await type('Product (EAN or name)', 'milk');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await flush();
    await pickFirstMatch();
}
async function press(text: string) {
    const button = [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === text,
    );
    if (!button) throw new Error(`No button ${text}`);
    button.click();
    await flush();
}

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    setActivePinia(createPinia());
    open.value = false;
    saved.length = 0;
    api.get.mockImplementation((url: string) => {
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
        return Promise.reject(new Error(url));
    });
});
afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = '';
    vi.useRealTimers();
});

function note(name: string): string | undefined {
    const button = document.querySelector(
        `[data-info-tooltip][aria-label="${name}"]`,
    );
    if (!button) return undefined;
    return document
        .getElementById(button.getAttribute('aria-describedby')!)
        ?.textContent?.trim();
}

describe('Purchase order Add product dialog help (#288)', () => {
    it('explains Ordered and Expected cost with the shared texts', async () => {
        mount();
        await show();
        await pickMilk();
        expect(note('About Ordered')).toBe(PURCHASE_ORDER_HELP.ordered);
        expect(note('About Expected cost')).toBe(
            PURCHASE_ORDER_HELP.expectedCost,
        );
        expect(field('Ordered (L)')).not.toBeNull();
        expect(field('Expected cost (₱/L)')).not.toBeNull();
    });
});

describe('Purchase order Add product dialog (#284)', () => {
    it('prefills the latest cost and adds one line', async () => {
        mount();
        await show();
        expect(document.activeElement).toBe(field('Product (EAN or name)'));
        await pickMilk();
        expect(api.get).toHaveBeenCalledWith('/suppliers/costs', {
            params: { products: 'p9' },
        });
        costs({ data: [{ product: 'p9', lastCost: 7550 }] });
        await flush();
        expect(field('Expected cost (₱/L)').value).toBe('75.50');
        await type('Ordered (L)', '1.5');
        await press('Add');
        expect(saved).toEqual([
            {
                product: 'p9',
                name: 'milk',
                EAN: '4800000000099',
                unit: UnitOfMeasure.L,
                tracksExpiry: undefined,
                quantity: '1.5',
                cost: '75.50',
            },
        ]);
        expect(open.value).toBe(false);
    });

    it('never overwrites a typed cost with a late answer', async () => {
        mount();
        await show();
        await pickMilk();
        await type('Expected cost', '60');
        costs({ data: [{ product: 'p9', lastCost: 7550 }] });
        await flush();
        expect(field('Expected cost').value).toBe('60');
    });

    it('keeps a cost typed before the pick, and across a product switch', async () => {
        mount();
        await show();
        await type('Expected cost', '55');
        await pickMilk();
        costs({ data: [{ product: 'p9', lastCost: 7550 }] });
        await flush();
        expect(field('Expected cost').value).toBe('55');
        await type('Ordered', '2');
        api.get.mockImplementation((url: string) => {
            if (url === 'products/matches')
                return Promise.resolve({
                    data: [
                        {
                            product: 'p3',
                            name: 'eggs',
                            EAN: '4800000000031',
                            unit: UnitOfMeasure.PIECE,
                        },
                    ],
                });
            return new Promise((resolve) => {
                costs = resolve;
            });
        });
        await type('Product (EAN or name)', 'eggs');
        await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
        await flush();
        await pickFirstMatch();
        costs({ data: [{ product: 'p3', lastCost: 900 }] });
        await flush();
        expect(field('Expected cost').value).toBe('55');
        // L to piece: the typed quantity no longer fits and is cleared.
        expect(field('Ordered (pc)').value).toBe('');
    });

    it('shows invalid fields inline and stays open', async () => {
        mount();
        await show();
        await press('Add');
        expect(fieldError('Product (EAN or name)')).toBe('Choose a product.');
        await pickMilk();
        await type('Ordered', '1.2345');
        await type('Expected cost', 'abc');
        await press('Add');
        expect(fieldError('Ordered')).not.toBe('');
        expect(fieldError('Expected cost')).toBe(
            'Enter an amount in pesos, up to 2 decimals',
        );
        expect(saved).toEqual([]);
        expect(open.value).toBe(true);
    });

    it('adds a ₱0 cost without a confirmation', async () => {
        mount();
        await show();
        await pickMilk();
        await type('Ordered', '2');
        await type('Expected cost', '0');
        await press('Add');
        expect(saved[0]).toMatchObject({ quantity: '2', cost: '0' });
        expect(document.body.textContent).not.toContain('₱0 cost?');
    });

    it('edits the line of a product already on the order', async () => {
        mount([
            {
                product: 'p9',
                name: 'milk',
                EAN: '4800000000099',
                unit: UnitOfMeasure.L,
                quantity: '3',
                cost: '70',
            },
        ]);
        await show();
        await pickMilk();
        expect(document.body.textContent).toContain('Edit line');
        expect(field('Ordered').value).toBe('3');
        expect(field('Expected cost').value).toBe('70');
        expect(api.get).not.toHaveBeenCalledWith(
            '/suppliers/costs',
            expect.anything(),
        );
        await type('Ordered', '4');
        await press('Update');
        expect(saved).toEqual([
            expect.objectContaining({
                product: 'p9',
                quantity: '4',
                cost: '70',
            }),
        ]);
    });

    it('opens with a scanned product picked and focuses Ordered', async () => {
        mount([], {
            _id: 'p2',
            name: 'rice',
            EAN: '4800000000024',
            unit: UnitOfMeasure.KG,
        } as ProductView);
        await show();
        expect(
            document.querySelector('[data-testid="combobox-selected"]')
                ?.textContent,
        ).toContain('rice');
        expect(document.activeElement).toBe(field('Ordered (kg)'));
        expect(field('Ordered (kg)').value).toBe('');
        expect(api.get).toHaveBeenCalledWith('/suppliers/costs', {
            params: { products: 'p2' },
        });
    });

    it('starts a scanned piece at 1', async () => {
        mount([], {
            _id: 'p1',
            name: 'soap',
            EAN: '4800000000017',
            unit: UnitOfMeasure.PIECE,
        } as ProductView);
        await show();
        expect(field('Ordered (pc)').value).toBe('1');
    });
});
