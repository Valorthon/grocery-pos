import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { flush } from '@/testing/form-dom';
import { ErrorCode, Role, type ProductView } from '@grocery-pos/contracts';
import { useAuthStore } from '@/stores/auth';
import { useUIStore } from '@/stores/ui';
import { INVENTORY_HELP } from '@/components/User/Inventory/inventory-help';
import EditProductDialog from './EditProductDialog.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

let app: App | null = null;
const isOpen = ref(false);
const current = ref<ProductView | null>(null);

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

interface MountOptions {
    roles?: Role[];
    stock?: number;
    product?: Partial<ProductView>;
    /** `GET /suppliers/costs` row's lastCost; undefined is unknown. */
    lastCost?: number;
}

async function mount(options: MountOptions = {}) {
    api.get.mockImplementation((url: string) =>
        Promise.resolve({
            data: url.endsWith('/movements/integrity')
                ? {
                      stock: options.stock ?? 0,
                      movementTotal: options.stock ?? 0,
                      matches: true,
                  }
                : url === '/suppliers/costs'
                  ? [
                        {
                            product: 'p1',
                            ...(options.lastCost !== undefined && {
                                lastCost: options.lastCost,
                            }),
                        },
                    ]
                  : { data: [], total: 0 },
        }),
    );
    isOpen.value = false;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const product = {
        _id: 'p1',
        EAN: '4006381333931',
        name: 'Rice',
        price: 5000,
        unit: 'PIECE',
        ...options.product,
    } as unknown as ProductView;
    const pinia = createPinia();
    setActivePinia(pinia);
    useAuthStore().user = {
        userId: 'u1',
        username: 'someone',
        roles: options.roles ?? [Role.Restocker],
    };
    current.value = product;
    app = createApp({
        render: () =>
            h(EditProductDialog, {
                modelValue: isOpen.value,
                'onUpdate:modelValue': (v: boolean) => (isOpen.value = v),
                product: current.value!,
            }),
    });
    app.use(pinia);
    app.mount(host);
    isOpen.value = true;
    await flush();
}

function note(name: string) {
    const button = document.querySelector<HTMLButtonElement>(
        `[data-info-tooltip][aria-label="${name}"]`,
    )!;
    const tip = document.getElementById(
        button.getAttribute('aria-describedby')!,
    )!;
    return { button, tip };
}

function labelled(text: string) {
    const label = [...document.querySelectorAll('label')].find((l) =>
        l.textContent?.trim().startsWith(text),
    )!;
    return { label, input: document.getElementById(label.htmlFor)! };
}

describe('EditProductDialog help notes (#273)', () => {
    it('reorder fields carry the shared notes after their labels', async () => {
        await mount();
        const level = note('About low stock at');
        const qty = note('About restock amount');
        expect(level.tip.textContent?.trim()).toBe(INVENTORY_HELP.reorderLevel);
        expect(qty.tip.textContent?.trim()).toBe(
            INVENTORY_HELP.reorderQuantity,
        );
        const { label } = labelled('Low stock at');
        expect(
            label.compareDocumentPosition(level.button) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(label.contains(level.button)).toBe(false);
        expect(level.button.parentElement!.classList).toContain('-my-3');
    });

    it('the label is tied to its input; the note does not focus it', async () => {
        await mount();
        const { label, input } = labelled('Restock amount');
        expect(input.tagName).toBe('INPUT');
        note('About restock amount').button.click();
        await flush();
        expect(document.activeElement).not.toBe(input);
        // jsdom doesn't run label activation; the for/id tie is what does.
        expect(label.htmlFor).toBe(input.id);
        expect(input.getAttribute('inputmode')).toBe('decimal');
    });

    it('Escape closes only the note, not the dialog', async () => {
        await mount();
        const { button, tip } = note('About low stock at');
        button.focus();
        await flush();
        expect(tip.classList.contains('hidden')).toBe(false);
        button.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            }),
        );
        await flush();
        expect(tip.classList.contains('hidden')).toBe(true);
        expect(isOpen.value).toBe(true);
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    });
});

function field(text: string) {
    const { input } = labelled(text);
    return {
        input: input as HTMLInputElement,
        error: () => {
            const id = input.getAttribute('aria-describedby');
            return id ? document.getElementById(id)?.textContent?.trim() : '';
        },
    };
}

async function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await flush();
}

function saveButton() {
    return [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Save',
    )!;
}

function httpError(data: unknown): AxiosError {
    const config = { headers: new AxiosHeaders() };
    return new AxiosError('failed', 'ERR_BAD_REQUEST', config, {}, {
        status: 400,
        statusText: '',
        headers: {},
        config,
        data,
    } as AxiosResponse);
}

const errorBody = (error: ErrorCode, details: unknown) => ({
    statusCode: 400,
    error,
    message: 'Failed',
    timestamp: '2026-11-11T00:00:00.000Z',
    path: '/v1/products',
    details,
    requestId: 'r1',
});

describe('EditProductDialog layout (#282)', () => {
    const headings = () =>
        [...document.querySelectorAll('[role="dialog"] h3')].map((h) =>
            h.textContent?.trim(),
        );

    it('groups fields; Pricing is ADMIN only', async () => {
        await mount({ roles: [Role.Restocker] });
        expect(headings()).toEqual(['Details', 'Stock planning']);
        expect(document.body.textContent).not.toContain('Selling price');
        app?.unmount();
        document.body.innerHTML = '';
        await mount({ roles: [Role.Admin] });
        expect(headings()).toEqual(['Details', 'Pricing', 'Stock planning']);
        expect(labelled('Selling price').input.tagName).toBe('INPUT');
    });

    it('header shows barcode, unit and status badges', async () => {
        await mount({
            product: { unit: 'KG', isActive: false } as Partial<ProductView>,
        });
        const header = document.querySelector(
            '[data-testid="product-header"]',
        )!;
        expect(header.textContent).toContain('4006381333931');
        const unit = header.querySelector('[data-testid="unit-badge"]')!;
        expect(unit.textContent).toContain('kg');
        expect(unit.getAttribute('title')).toMatch(/cannot be changed/);
        expect(
            header.querySelector('[data-testid="product-status"]')!.textContent,
        ).toContain('Archived');
        expect(document.body.textContent).not.toContain('Unit: ');
    });

    it('shows Active for an active product', async () => {
        await mount();
        expect(
            document.querySelector('[data-testid="product-status"]')!
                .textContent,
        ).toContain('Active');
    });
});

describe('EditProductDialog errors (#282)', () => {
    it('client checks render under their own field and clear on edit', async () => {
        await mount({ roles: [Role.Admin] });
        const name = field('Product name');
        const price = field('Selling price');
        const level = field('Low stock at');
        const qty = field('Restock amount');
        await type(name.input, '  ');
        await type(price.input, 'abc');
        await type(level.input, '-1');
        await type(qty.input, '0');
        saveButton().click();
        await flush();
        expect(api.patch).not.toHaveBeenCalled();
        expect(name.error()).toBe('Enter a valid product name.');
        expect(price.error()).toBe('Enter a valid selling price.');
        expect(level.error()).toBe('Enter a valid low stock level.');
        expect(qty.error()).toBe('Enter a positive restock amount.');
        expect(document.querySelector('[role="alert"]')).toBeNull();
        await type(name.input, 'rice');
        expect(name.error()).toBeFalsy();
        expect(price.error()).toBe('Enter a valid selling price.');
        await type(price.input, '10');
        await type(level.input, '1');
        await type(qty.input, '2');
        expect(price.error()).toBeFalsy();
        expect(level.error()).toBeFalsy();
        expect(qty.error()).toBeFalsy();
    });

    it('a taken name is inline under the name, not a toast', async () => {
        await mount();
        api.patch.mockRejectedValueOnce(
            httpError(
                errorBody(ErrorCode.DB_DUPLICATE_KEY, [
                    { property: 'name', msg: 'Already exists' },
                ]),
            ),
        );
        saveButton().click();
        await flush();
        expect(field('Product name').error()).toBe(
            'A product with this name already exists',
        );
        expect(useUIStore().toasts).toHaveLength(0);
        expect(document.body.textContent).not.toContain('name: ');
        expect(isOpen.value).toBe(true);
        // Saving was reset: a second Save goes out and closes.
        api.patch.mockResolvedValueOnce({ data: null });
        await type(field('Product name').input, 'rice two');
        saveButton().click();
        await flush();
        expect(api.patch).toHaveBeenCalledTimes(2);
        expect(isOpen.value).toBe(false);
    });

    it('another server error is a toast', async () => {
        await mount();
        api.patch.mockRejectedValueOnce(
            httpError(errorBody(ErrorCode.VALIDATION_INVALID_INPUT, null)),
        );
        saveButton().click();
        await flush();
        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([['Failed']]);
        expect(field('Product name').error()).toBeFalsy();
    });
});

describe('EditProductDialog expiry box (#282)', () => {
    const box = () =>
        document.querySelector<HTMLInputElement>(
            '[role="dialog"] input[type="checkbox"]',
        )!;
    const hint = () =>
        document
            .getElementById(box().getAttribute('aria-describedby')!)!
            .textContent?.trim();

    const help = () =>
        document.querySelector<HTMLButtonElement>(
            '[data-testid="expiry-help"] button',
        )!;
    const tipText = () =>
        document
            .getElementById(help().getAttribute('aria-describedby')!)!
            .textContent?.trim();

    it('is disabled with the reason in an ⓘ when stock is not zero (#290)', async () => {
        await mount({ stock: 5 });
        expect(box().disabled).toBe(true);
        expect(help().disabled).toBe(false);
        expect(tipText()).toContain('zero stock and no batch history');
        expect(hint()).toBe(tipText());
        expect(document.body.textContent).not.toContain('Only at zero stock');
    });

    it('is enabled at zero stock with the same ⓘ (#290)', async () => {
        await mount({ stock: 0 });
        expect(box().disabled).toBe(false);
        expect(tipText()).toContain('Sell, adjust or count it down');
        expect(document.body.textContent).not.toContain(
            'Change only at zero stock',
        );
    });
});

describe('EditProductDialog stock answers (#282 review)', () => {
    it("a late answer for product A never sets product B's box", async () => {
        const pending = new Map<string, (stock: number) => void>();
        await mount({ product: { _id: 'a' } });
        api.get.mockImplementation((url: string) =>
            url.endsWith('/movements/integrity')
                ? new Promise((resolve) =>
                      pending.set(url.split('/')[2]!, (stock) =>
                          resolve({
                              data: {
                                  stock,
                                  movementTotal: stock,
                                  matches: true,
                              },
                          }),
                      ),
                  )
                : Promise.resolve({ data: { data: [], total: 0 } }),
        );
        // Reopen for A with its answer pending, then switch to B.
        isOpen.value = false;
        await flush();
        isOpen.value = true;
        await flush();
        current.value = { ...current.value!, _id: 'b', name: 'banana' };
        await flush();
        pending.get('b')!(0);
        await flush();
        pending.get('a')!(5);
        await flush();
        const box = document.querySelector<HTMLInputElement>(
            '[role="dialog"] input[type="checkbox"]',
        )!;
        expect(box.disabled).toBe(false);
    });
});

describe('EditProductDialog pricing tiles (#290)', () => {
    const tile = (id: string) =>
        document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

    it('shows cost, margin and profit, and follows the typed price', async () => {
        await mount({ roles: [Role.Admin], lastCost: 3641 });
        expect(tile('tile-cost').textContent).toContain('36.41/pc');
        // 5000 vs 3641: trunc(1359 * 10000 / 5000) = 2718 bp.
        expect(tile('tile-margin').textContent).toContain('27.18%');
        expect(tile('tile-margin').textContent).toContain('13.59/pc');
        await type(field('Selling price').input, '114.29');
        expect(tile('tile-margin').textContent).toContain('68.14%');
        expect(tile('tile-margin').textContent).toContain('77.88/pc');
    });

    it('labels Latest cost and Margin and boxes values like the input (#294)', async () => {
        await mount({ roles: [Role.Admin], lastCost: 3641 });
        const input = field('Selling price').input;
        for (const [id, label] of [
            ['tile-cost', 'Latest cost'],
            ['tile-margin', 'Margin'],
        ] as const) {
            const box = tile(id).querySelector<HTMLElement>(
                '[data-readonly-box]',
            )!;
            const name = document.getElementById(
                box.getAttribute('aria-labelledby')!,
            )!;
            expect(name.textContent!.trim()).toBe(label);
            expect(name.className).toContain('font-semibold');
            expect(box.tagName).toBe('OUTPUT');
            for (const cls of [
                'py-2.5',
                'text-sm',
                'border',
                'rounded-control',
            ]) {
                expect(input.classList).toContain(cls);
                expect(box.classList).toContain(cls);
            }
            expect(box.classList).toContain('break-words');
        }
        expect(
            tile('tile-margin').querySelector('[data-readonly-box]')!
                .textContent,
        ).toContain('27.18% · ₱13.59/pc');
        expect(
            document
                .querySelector('[data-testid="tile-cost"]')!
                .closest('[data-testid="pricing-row"]'),
        ).not.toBeNull();
    });

    it('a negative margin is red with a tone label', async () => {
        await mount({ roles: [Role.Admin], lastCost: 6000 });
        await type(field('Selling price').input, '40');
        const margin = tile('tile-margin');
        expect(margin.textContent).toContain('-50.00%');
        expect(margin.textContent).toContain('negative margin');
        expect(
            margin.querySelector('[data-readonly-box]')!.classList,
        ).toContain('text-danger-fg');
    });

    it('an invalid or empty price shows —', async () => {
        await mount({ roles: [Role.Admin], lastCost: 100 });
        await type(field('Selling price').input, 'abc');
        expect(tile('tile-margin').textContent).toContain('—');
        await type(field('Selling price').input, '');
        expect(tile('tile-margin').textContent).toContain('—');
    });

    it('unknown cost reads Unknown and —', async () => {
        await mount({ roles: [Role.Admin] });
        expect(tile('tile-cost').textContent).toContain('Unknown');
        expect(tile('tile-margin').textContent).toContain('—');
    });

    it('keeps the price input a minimum width and gives Margin the wider column', async () => {
        await mount({ roles: [Role.Admin], lastCost: 100 });
        const row = document.querySelector('[data-testid="pricing-row"]')!;
        // Price ≥8rem, the pair gets 2.6fr split 1:1.6, so the Margin
        // box fits "-50.00% · -₱20.00/pc" on one line at 32rem (#294).
        expect(row.className).toContain('minmax(8rem,1fr)_minmax(0,2.6fr)');
        const pair = document.querySelector('[data-testid="cost-tiles"]')!;
        expect(pair.classList).toContain('grid-cols-2');
        expect(pair.className).toContain('minmax(0,1.6fr)');
        expect(pair.classList).not.toContain('items-start');
        for (const box of pair.querySelectorAll('[data-readonly-box]')) {
            expect(box.classList).toContain('flex-1');
            expect(box.getAttribute('aria-live')).toBe('off');
        }
    });

    it('non-ADMIN users see no tiles', async () => {
        await mount({ roles: [Role.Restocker], lastCost: 100 });
        expect(document.querySelector('[data-testid="cost-tiles"]')).toBeNull();
    });
});
