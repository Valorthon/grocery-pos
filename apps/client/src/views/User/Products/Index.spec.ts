import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { click, field, flush, type } from '@/testing/form-dom';
import Index from './Index.vue';
import type { ApiGet } from '@/testing/api-mock';
import type { Router } from 'vue-router';
import { Role, UnitOfMeasure } from '@grocery-pos/contracts';
import { useAuthStore } from '@/stores/auth';

const api = vi.hoisted(() => ({ get: vi.fn<ApiGet>(), patch: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
// The app's own route table answers `resolve`, so the Add button follows
// the real Products/Add meta.
const routes = vi.hoisted(() => ({
    resolve: null as null | Router['resolve'],
}));
vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal<typeof import('vue-router')>()),
    useRouter: () => ({
        push: vi.fn(),
        resolve: (...args: Parameters<Router['resolve']>) =>
            routes.resolve!(...args),
    }),
}));

const { default: appRouter } = await import('@/router');
routes.resolve = appRouter.resolve.bind(appRouter);

let app: App | null = null;

beforeEach(() => {
    setActivePinia(createPinia());
    api.patch.mockReset().mockResolvedValue({ data: null });
    api.get.mockReset().mockResolvedValue({
        data: {
            data: [
                { _id: 'p1', EAN: '4006381333931', name: 'milk', price: 5000 },
            ],
            totalItems: 30,
        },
    });
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(Index);
    app.mount(host);
    await flush();
}

const params = () => api.get.mock.calls.map(([, config]) => config?.params);

describe('product list FilterBar (#171)', () => {
    const chip = (label: string) =>
        document.querySelector<HTMLButtonElement>(
            `button[aria-label="Remove filter ${label}"]`,
        );

    it('removes one chip with one load and never sends unsearched text', async () => {
        await mount();
        await type('EAN / Barcode', '4006');
        await type('Product Name', 'milk');
        await click('Search');
        expect(chip('Name: milk')).not.toBeNull();
        expect(chip('EAN: 4006')).not.toBeNull();
        await type('Product Name', 'bread');
        expect(chip('Name: bread')).toBeNull();
        api.get.mockClear();

        chip('EAN: 4006')!.click();
        await flush();

        expect(params()).toEqual([
            expect.objectContaining({ page: 1, name: 'MILK', EAN: '' }),
        ]);
        expect(field('Product Name').value).toBe('milk');
    });
});

describe('product list search (issue #20)', () => {
    it('searches from the Search button', async () => {
        await mount();
        await type('Product Name', 'milk');
        api.get.mockClear();

        await click('Search');

        expect(params()).toEqual([
            expect.objectContaining({ page: 1, name: 'MILK' }),
        ]);
    });

    it('loads page 1 once when Enter searches from page 2', async () => {
        await mount();
        await click('Next');
        expect(params().slice(-1)[0]).toMatchObject({ page: 2 });
        await type('Product Name', 'milk');
        api.get.mockClear();

        // Enter submits the FilterBar search form once.
        field('Product Name').form!.requestSubmit();
        await flush();

        expect(params()).toEqual([
            expect.objectContaining({ page: 1, name: 'MILK' }),
        ]);
    });

    it('pages and resizes with the last search, not unsearched text', async () => {
        await mount();
        await type('Product Name', 'milk');
        await click('Search');
        await type('Product Name', 'bread');
        api.get.mockClear();

        await click('Next');
        const size = document
            .querySelectorAll('select')
            .item(document.querySelectorAll('select').length - 1)!;
        size.value = '25';
        size.dispatchEvent(new Event('change'));
        await flush();

        expect(params()).toEqual([
            expect.objectContaining({ page: 2, name: 'MILK' }),
            expect.objectContaining({ page: 1, limit: 25, name: 'MILK' }),
        ]);
    });

    it('searches for everything again when the box is cleared with ×', async () => {
        await mount();
        await type('Product Name', 'milk');
        await click('Search');
        api.get.mockClear();

        const clear =
            field('Product Name').parentElement!.querySelector('button')!;
        clear.click();
        await flush();

        expect(params()).toEqual([
            expect.objectContaining({ page: 1, name: '' }),
        ]);
    });

    it('loads page 1 once when the page size changes on page 3', async () => {
        await mount();
        await click('Next');
        await click('Next');
        api.get.mockClear();

        const size = document
            .querySelectorAll('select')
            .item(document.querySelectorAll('select').length - 1)!;
        size.value = '25';
        size.dispatchEvent(new Event('change'));
        await flush();

        expect(params()).toEqual([
            expect.objectContaining({ page: 1, limit: 25 }),
        ]);
    });
});

describe('Add Products button (issue #83)', () => {
    function addButton(): HTMLButtonElement | undefined {
        return [...document.querySelectorAll('button')].find((b) =>
            b.textContent?.includes('Add Products'),
        );
    }

    async function mountAs(roles: Role[]) {
        useAuthStore().user = { userId: 'u1', username: 'someone', roles };
        await mount();
    }

    it('is hidden from an Adjuster, who cannot open Products/Add', async () => {
        await mountAs([Role.Adjuster]);
        expect(addButton()).toBeUndefined();
    });

    it.each([
        [[Role.Restocker]],
        [[Role.Admin]],
        [[Role.Adjuster, Role.Restocker]],
    ])('is shown to %j', async (roles) => {
        await mountAs(roles);
        expect(addButton()).toBeDefined();
    });

    it('is hidden with no signed-in user', async () => {
        await mount();
        expect(addButton()).toBeUndefined();
    });
});

describe('product editing and archival', () => {
    beforeEach(() => {
        useAuthStore().user = {
            userId: 'admin',
            username: 'admin',
            roles: [Role.Admin],
        };
    });
    it('sends changed prices in integer centavos and closes only after save', async () => {
        await mount();
        await click('Edit');
        await type('Product name', 'new milk');
        await type('Selling price (₱)', '65.25');
        await click('Save');
        expect(api.patch).toHaveBeenCalledWith('/products', {
            updates: [
                { product: 'p1', update: { name: 'new milk', price: 6525 } },
            ],
        });
        expect(document.querySelector('[role=dialog]')).toBeNull();
    });
    it.each(['success', 'failure'] as const)(
        'holds the editor open during a pending save and handles %s',
        async (outcome) => {
            let resolve!: (value: { data: null }) => void;
            let reject!: (reason: Error) => void;
            api.patch.mockImplementationOnce(
                () =>
                    new Promise((yes, no) => {
                        resolve = yes;
                        reject = no;
                    }),
            );
            await mount();
            await click('Edit');
            await type('Selling price (₱)', '65.25');
            await click('Save');
            expect(api.patch).toHaveBeenCalledTimes(1);
            expect(document.querySelector('[data-modal-close]')).toBeNull();
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
            );
            await flush();
            const dialog =
                document.querySelector<HTMLElement>('[role=dialog]')!;
            dialog.parentElement!.dispatchEvent(
                new MouseEvent('mousedown', { bubbles: true }),
            );
            await flush();
            await click('Cancel');
            expect(document.querySelector('[role=dialog]')).not.toBeNull();
            expect(api.patch).toHaveBeenCalledTimes(1);
            if (outcome === 'success') {
                resolve({ data: null });
                await flush();
                expect(document.querySelector('[role=dialog]')).toBeNull();
            } else {
                reject(new Error('network'));
                await flush();
                expect(document.querySelector('[role=dialog]')).not.toBeNull();
                expect(document.querySelector('[role=alert]')).not.toBeNull();
                expect(
                    document.querySelector('[data-modal-close]'),
                ).not.toBeNull();
                await click('Save');
                expect(api.patch).toHaveBeenCalledTimes(2);
                expect(document.querySelector('[role=dialog]')).toBeNull();
            }
        },
    );
    it('restockers can edit names but are not offered price editing', async () => {
        useAuthStore().user = {
            userId: 'restock',
            username: 'restock',
            roles: [Role.Restocker],
        };
        await mount();
        await click('Edit');
        expect(document.body.textContent).not.toContain('Selling price (₱)');
        await type('Product name', 'renamed milk');
        await click('Save');
        expect(api.patch).toHaveBeenCalledWith('/products', {
            updates: [{ product: 'p1', update: { name: 'renamed milk' } }],
        });
    });
    it('keeps failed edits open with an error', async () => {
        api.patch.mockRejectedValue(new Error('network'));
        await mount();
        await click('Edit');
        await click('Save');
        expect(document.querySelector('[role=dialog]')).not.toBeNull();
        expect(document.querySelector('[role=alert]')).not.toBeNull();
    });
    it('confirms archiving and cancellation does not write', async () => {
        await mount();
        await click('Archive');
        await click('Cancel');
        expect(api.patch).not.toHaveBeenCalled();
        await click('Archive');
        const buttons = [...document.querySelectorAll('[role=dialog] button')];
        (
            buttons.find(
                (b) => b.textContent?.trim() === 'Archive',
            ) as HTMLButtonElement
        ).click();
        await flush();
        expect(api.patch).toHaveBeenCalledWith('/products', {
            updates: [{ product: 'p1', update: { isActive: false } }],
        });
    });
});

it('validates product names and prices before saving', async () => {
    useAuthStore().user = {
        userId: 'admin',
        username: 'admin',
        roles: [Role.Admin],
    };
    await mount();
    await click('Edit');
    await type('Product name', ' ');
    await click('Save');
    expect(api.patch).not.toHaveBeenCalled();
    expect(document.querySelector('[role=alert]')?.textContent).toContain(
        'name',
    );
    await type('Product name', 'milk');
    await type('Selling price (₱)', '0');
    await click('Save');
    expect(api.patch).not.toHaveBeenCalled();
    expect(document.querySelector('[role=alert]')?.textContent).toContain(
        'price',
    );
});
it('restores archived products after confirmation', async () => {
    useAuthStore().user = {
        userId: 'admin',
        username: 'admin',
        roles: [Role.Admin],
    };
    api.get.mockResolvedValue({
        data: {
            data: [
                {
                    _id: 'p1',
                    EAN: '4006381333931',
                    name: 'milk',
                    price: 5000,
                    isActive: false,
                },
            ],
            totalItems: 1,
        },
    });
    await mount();
    await click('Restore');
    const confirm = [...document.querySelectorAll('[role=dialog] button')].find(
        (b) => b.textContent?.trim() === 'Restore',
    ) as HTMLButtonElement;
    confirm.click();
    await flush();
    expect(api.patch).toHaveBeenCalledWith('/products', {
        updates: [{ product: 'p1', update: { isActive: true } }],
    });
});

it('restocker sets measured reorder settings without gaining price permission', async () => {
    useAuthStore().user = {
        userId: 'restocker',
        username: 'restocker',
        roles: [Role.Restocker],
    };
    api.get.mockResolvedValue({
        data: {
            data: [
                {
                    _id: 'rice',
                    EAN: '4006381333931',
                    name: 'rice',
                    price: 18000,
                    unit: UnitOfMeasure.KG,
                },
            ],
            totalItems: 1,
        },
    });
    await mount();
    await click('Edit');
    expect(document.body.textContent).not.toContain('Selling price (₱)');
    await type('Reorder level (kg)', '0.450');
    await type('Restock quantity (kg)', '2.500');
    await click('Save');
    expect(api.patch).toHaveBeenCalledWith('/products', {
        updates: [
            {
                product: 'rice',
                update: {
                    name: 'rice',
                    reorderLevel: 450,
                    reorderQuantity: 2500,
                },
            },
        ],
    });
});
it('rejects fractional pieces, negative levels and blank reorder quantities before saving', async () => {
    useAuthStore().user = {
        userId: 'r',
        username: 'r',
        roles: [Role.Restocker],
    };
    await mount();
    await click('Edit');
    for (const [label, value] of [
        ['Reorder level (pc)', '0.5'],
        ['Reorder level (pc)', '-1'],
        ['Restock quantity (pc)', ''],
    ]) {
        await type('Reorder level (pc)', '10');
        await type('Restock quantity (pc)', '10');
        await type(label!, value!);
        await click('Save');
        expect(api.patch).not.toHaveBeenCalled();
        expect(document.querySelector('[role=alert]')?.textContent).toContain(
            'reorder',
        );
    }
});
