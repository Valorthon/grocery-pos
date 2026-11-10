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

/** Opens the row's action menu (#172) and picks one of its items. */
async function rowAction(label: string, row = 'milk') {
    const trigger = document.querySelector<HTMLButtonElement>(
        `button[aria-label="Actions for ${row}"]`,
    );
    if (!trigger) throw new Error(`no menu for ${row}`);
    trigger.click();
    await flush();
    const item = [
        ...document.querySelectorAll<HTMLButtonElement>('[role=menuitem]'),
    ].find((b) => b.textContent?.trim() === label);
    if (!item) throw new Error(label);
    item.click();
    await flush();
}

const params = () => api.get.mock.calls.map(([, config]) => config?.params);

describe('product list FilterBar (#171, #215)', () => {
    const clear = () =>
        [...document.querySelectorAll('button')].find((b) =>
            b.textContent?.includes('Clear Filters'),
        )!;

    it('shows no chips; Clear Filters is enabled only off the defaults and resets with one load', async () => {
        await mount();
        expect(clear().disabled).toBe(true);
        await type('EAN / Barcode', '4006');
        expect(clear().disabled).toBe(false);
        await type('Product Name', 'milk');
        await click('Search');
        expect(document.querySelector('[data-chip]')).toBeNull();
        api.get.mockClear();

        await click('Clear Filters');

        expect(params()).toEqual([
            expect.objectContaining({ page: 1, name: '', EAN: '' }),
        ]);
        expect(field('Product Name').value).toBe('');
        expect(clear().disabled).toBe(true);
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
        await rowAction('Edit');
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
            await rowAction('Edit');
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
        await rowAction('Edit');
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
        await rowAction('Edit');
        await click('Save');
        expect(document.querySelector('[role=dialog]')).not.toBeNull();
        expect(document.querySelector('[role=alert]')).not.toBeNull();
    });
    it('confirms archiving and cancellation does not write', async () => {
        await mount();
        await rowAction('Archive');
        await click('Cancel');
        expect(api.patch).not.toHaveBeenCalled();
        await rowAction('Archive');
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
    await rowAction('Edit');
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
    await rowAction('Restore');
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
    await rowAction('Edit', 'rice');
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
    await rowAction('Edit');
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

describe('columns and row menu (#172)', () => {
    const menuItems = () =>
        [...document.querySelectorAll('[role=menuitem]')].map((b) =>
            b.textContent?.trim(),
        );
    it('puts Name first, then Category and Price', async () => {
        await mount();
        const titles = [...document.querySelectorAll('thead th')].map((th) =>
            th.textContent?.trim(),
        );
        expect(titles.slice(0, 3)).toEqual(['Name', 'Category', 'Price']);
        expect(titles).not.toContain('History');
    });
    it('offers an Adjuster only Stock history, which opens the history', async () => {
        useAuthStore().user = {
            userId: 'a',
            username: 'a',
            roles: [Role.Adjuster],
        };
        await mount();
        const trigger = document.querySelector<HTMLButtonElement>(
            'button[aria-label="Actions for milk"]',
        )!;
        expect(trigger.className).toContain('w-11 h-11');
        trigger.click();
        await flush();
        expect(menuItems()).toEqual(['Stock history']);
        await rowAction('Stock history');
        expect(document.querySelector('[role=dialog]')?.textContent).toContain(
            'Stock history — milk',
        );
    });
    it('opens from the keyboard and gives the focus back to the trigger', async () => {
        useAuthStore().user = {
            userId: 'admin',
            username: 'admin',
            roles: [Role.Admin],
        };
        await mount();
        const trigger = document.querySelector<HTMLButtonElement>(
            'button[aria-label="Actions for milk"]',
        )!;
        trigger.focus();
        trigger.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
        );
        await flush();
        expect(menuItems()).toEqual(['Stock history', 'Edit', 'Archive']);
        expect(document.activeElement?.textContent?.trim()).toBe(
            'Stock history',
        );
        document.activeElement!.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await flush();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(trigger);
        trigger.click();
        await flush();
        const archive = [
            ...document.querySelectorAll<HTMLButtonElement>('[role=menuitem]'),
        ].find((b) => b.textContent?.trim() === 'Archive')!;
        archive.focus();
        archive.click();
        await flush();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        // The confirmation still asks before anything is written.
        expect(document.querySelector('[role=dialog]')).not.toBeNull();
        expect(api.patch).not.toHaveBeenCalled();
        await click('Cancel');
        await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    });
});

describe('product list scans (#214)', () => {
    const SCAN = '4006381333931';
    function answer(rows: object[]) {
        api.get.mockImplementation((url, config) =>
            Promise.resolve({
                data:
                    url === '/products' && config?.params?.status === 'all'
                        ? { data: rows, totalItems: rows.length }
                        : { data: [], totalItems: 0 },
            }),
        );
    }
    const archived = {
        _id: 'p1',
        EAN: SCAN,
        name: 'milk',
        price: 5000,
        isActive: false,
    };
    async function scanInto(label: string) {
        await type(label, SCAN);
        api.get.mockClear();
        field(label).form!.requestSubmit();
        await flush();
    }

    it('opens Edit for a product editor, archived too, without filtering', async () => {
        useAuthStore().user = { username: 'r', roles: [Role.Restocker] };
        answer([archived]);
        await mount();
        await scanInto('EAN / Barcode');
        expect(document.body.textContent).toContain('Edit Product');
        expect(params()[0]).toEqual({
            EAN: SCAN,
            status: 'all',
            page: 1,
            limit: 100,
        });
        expect(params()).not.toContainEqual(
            expect.objectContaining({ status: 'active' }),
        );
    });

    it('opens Stock history for an Adjuster, from the name box too', async () => {
        useAuthStore().user = { username: 'a', roles: [Role.Adjuster] };
        answer([archived]);
        await mount();
        await scanInto('Product Name');
        expect(document.body.textContent).toContain('Stock history — milk');
        expect(document.body.textContent).not.toContain('Edit Product');
    });

    it('falls back to the filtered search without one exact match', async () => {
        useAuthStore().user = { username: 'r', roles: [Role.Restocker] };
        answer([{ ...archived, EAN: `${SCAN}9` }]);
        await mount();
        await scanInto('EAN / Barcode');
        expect(document.body.textContent).not.toContain('Edit Product');
        expect(params()).toEqual([
            { EAN: SCAN, status: 'all', page: 1, limit: 100 },
            expect.objectContaining({ page: 1, EAN: SCAN, status: 'active' }),
        ]);
    });
});
