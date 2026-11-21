import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import SupplierSelect from './SupplierSelect.vue';
import { flush } from '@/testing/form-dom';
import { createMemoryHistory, createRouter } from 'vue-router';
import { Role, useAuthStore } from '@/stores/auth';
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
let app: App | undefined;
async function mount() {
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(SupplierSelect);
    app.mount(host);
    await flush();
}
beforeEach(() => {
    setActivePinia(createPinia());
    api.get.mockResolvedValue({
        data: {
            data: [
                { _id: 'one', name: 'Farm', isActive: true },
                { _id: 'old', name: 'Archived', isActive: false },
            ],
            totalItems: 2,
        },
    });
});
afterEach(() => {
    app?.unmount();
    document.body.innerHTML = '';
});
describe('active supplier selection', () => {
    it('offers active suppliers and excludes archived suppliers', async () => {
        await mount();
        const options = [...document.querySelectorAll('option')].map(
            (row) => row.textContent,
        );
        expect(options).toContain('Farm');
        expect(options).not.toContain('Archived');
    });
    it('exposes catalogue errors and retries the lookup', async () => {
        api.get.mockRejectedValueOnce(new Error('offline'));
        await mount();
        expect(document.querySelector('[role=alert]')).not.toBeNull();
        document.querySelector<HTMLButtonElement>('button')!.click();
        await flush();
        expect(document.querySelector('[role=alert]')).toBeNull();
        expect(document.body.textContent).toContain('Farm');
    });
});
describe('no active supplier (#424)', () => {
    async function mountAs(roles: Role[]) {
        api.get.mockResolvedValue({
            data: {
                data: [{ _id: 'old', name: 'Archived', isActive: false }],
                totalItems: 1,
            },
        });
        useAuthStore().$patch({ user: { roles } } as never);
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/', component: { render: () => null } },
                {
                    path: '/suppliers',
                    name: 'Suppliers',
                    component: { render: () => null },
                },
            ],
        });
        const host = document.createElement('div');
        document.body.append(host);
        app = createApp(SupplierSelect);
        app.use(router);
        app.mount(host);
        await flush();
        return document.querySelector('[data-testid=no-suppliers]');
    }
    it('links a restocker to Suppliers', async () => {
        const hint = await mountAs([Role.Restocker]);
        expect(hint?.textContent).toContain('No suppliers yet');
        expect(hint?.querySelector('a')?.getAttribute('href')).toBe(
            '/suppliers',
        );
    });
    it('shows plain text to a viewer who cannot manage suppliers', async () => {
        const hint = await mountAs([Role.Seller]);
        expect(hint?.textContent).toContain('No suppliers yet');
        expect(hint?.querySelector('a')).toBeNull();
    });
    it('shows no hint while an active supplier exists', async () => {
        await mount();
        expect(document.querySelector('[data-testid=no-suppliers]')).toBeNull();
    });
});
