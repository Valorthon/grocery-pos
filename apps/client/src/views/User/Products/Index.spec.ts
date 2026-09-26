import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { click, field, flush, type } from '@/testing/form-dom';
import Index from './Index.vue';
import type { ApiGet } from '@/testing/api-mock';
import type { Router } from 'vue-router';
import { Role } from '@grocery-pos/contracts';
import { useAuthStore } from '@/stores/auth';

const api = vi.hoisted(() => ({ get: vi.fn<ApiGet>() }));
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

        field('Product Name').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter' }),
        );
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
        const size = document.querySelector('select')!;
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

        const size = document.querySelector('select')!;
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
