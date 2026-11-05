import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { click, flush, type } from '@/testing/form-dom';
import type { ApiGet } from '@/testing/api-mock';
import Restocks from './Restock/Index.vue';
import Adjustments from './Adjustments/Index.vue';

const api = vi.hoisted(() => ({ get: vi.fn<ApiGet>() }));
vi.mock('@/axios', () => ({ default: api }));
const first = 'a'.repeat(24);
const second = 'b'.repeat(24);
let app: App | undefined;

beforeEach(() => {
    api.get.mockReset().mockImplementation((url) =>
        Promise.resolve({
            data: url.endsWith('/users') ? [] : { data: [], totalItems: 30 },
        }),
    );
});
afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = '';
});

describe.each([
    { path: '/restocks', component: Restocks },
    { path: '/adjustments', component: Adjustments },
])('source history navigation: $path', ({ path, component }) => {
    async function mount() {
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [{ path, component }],
        });
        await router.push({ path, query: { source: first } });
        const host = document.createElement('div');
        document.body.appendChild(host);
        app = createApp(RouterView);
        app.use(createPinia()).use(router).mount(host);
        await flush();
        return router;
    }
    const requests = () =>
        api.get.mock.calls
            .filter(([url]) => url === path)
            .map(([, c]) => c?.params);

    it('follows source changes and sidebar navigation without remounting or applying typed dates', async () => {
        const router = await mount();
        expect(requests()[requests().length - 1]?.source).toBe(first);
        await type('From', '2026-11-05');
        // A reversed end date remains an unapplied edit.
        await type('To', '2026-11-01');
        const appliedFrom = requests()[requests().length - 1]?.dateFrom;
        await click('Next');
        api.get.mockClear();
        await router.push({ path, query: { source: second } });
        await flush();
        expect(requests()).toHaveLength(1);
        expect(requests()[0]).toMatchObject({
            source: second,
            page: 1,
            dateFrom: appliedFrom,
        });
        expect(requests()[0]?.dateTo).toBeUndefined();
        expect(document.body.textContent).toContain(`Showing source ${second}`);
        api.get.mockClear();
        await router.push(path);
        await flush();
        expect(requests()).toHaveLength(1);
        expect(requests()[0]?.source).toBeUndefined();
        expect(document.body.textContent).not.toContain('Showing source');
        await click('Clear Filters');
        expect(requests()[requests().length - 1]?.source).toBeUndefined();
    });

    it('clears the visible source restriction and ignores malformed source IDs', async () => {
        const router = await mount();
        api.get.mockClear();
        await click('Clear Filters');
        await flush();
        expect(router.currentRoute.value.query.source).toBeUndefined();
        expect(requests()).toHaveLength(1);
        expect(requests()[0]?.source).toBeUndefined();
        api.get.mockClear();
        await router.push({ path, query: { source: 'not-an-id' } });
        await flush();
        // Invalid route text never becomes a backend filter, even on retry.
        await click('Next');
        expect(requests()[requests().length - 1]?.source).toBeUndefined();
        expect(document.body.textContent).not.toContain('Showing source');
    });
});
