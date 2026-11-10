import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { Role } from '@grocery-pos/contracts';
import { flush } from '@/testing/form-dom';
import { useAuthStore } from '@/stores/auth';
import Index from './Index.vue';
import { canOpenPurchaseOrders } from './purchase-order-link';

const api = vi.hoisted(() => ({
    get: vi.fn<
        (url: string, config?: { params?: unknown }) => Promise<unknown>
    >(),
}));
vi.mock('@/axios', () => ({ default: api }));
const nav = vi.hoisted(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    route: { value: { query: {} as Record<string, string> } },
}));
vi.mock('vue-router', () => ({
    useRoute: () => ({ meta: { title: 'Restock history' }, query: {} }),
    useRouter: () => ({
        push: nav.push,
        replace: nav.replace,
        currentRoute: nav.route,
    }),
}));
const PO = '507f1f77bcf86cd799439abc';
let app: App | null = null;
beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    nav.route.value = { query: { purchaseOrder: PO } };
    api.get.mockImplementation((url: string) =>
        Promise.resolve(
            url === '/restocks/users'
                ? { data: [] }
                : {
                      data: {
                          data: [
                              {
                                  _id: 'r1',
                                  description: 'Purchase order PO-99439ABC',
                                  restockedBy: { name: 'rex' },
                                  purchaseOrder: PO,
                                  totalCost: 100,
                                  createdAt: '2026-11-06T00:00:00.000Z',
                              },
                          ],
                          totalItems: 1,
                      },
                  },
        ),
    );
});
afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});
async function mount(roles: Role[]) {
    useAuthStore().user = { userId: 'u', username: 'u', roles };
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(Index);
    app.mount(host);
    await flush();
}

describe('restock history purchase-order links (#123)', () => {
    it('filters by the linked order and opens it', async () => {
        await mount([Role.Restocker]);
        expect(
            api.get.mock.calls.find((c) => c[0] === '/restocks')?.[1]?.params,
        ).toMatchObject({ purchaseOrder: PO });
        const link = [...document.querySelectorAll('button')].find(
            (b) => b.textContent?.trim() === 'PO-99439ABC',
        )!;
        link.click();
        expect(nav.push).toHaveBeenCalledWith({
            name: 'PurchaseOrders',
            query: { id: PO },
        });
        const clear = [...document.querySelectorAll('button')].find((b) =>
            b.textContent?.includes('Clear Filters'),
        )!;
        // The deep link is named above the table (#215).
        expect(
            document.querySelector('[data-testid="deep-link-note"]')
                ?.textContent,
        ).toContain('Showing receipts for PO-99439ABC');
        // The deep link alone enables Clear Filters (#215).
        expect(clear.disabled).toBe(false);
        clear.click();
        expect(nav.replace).toHaveBeenCalledWith({
            query: { purchaseOrder: undefined, source: undefined },
        });
    });
    it('gates the link on the roles that can open purchase orders', () => {
        const has = (roles: Role[]) => (role: Role) => roles.includes(role);
        expect(canOpenPurchaseOrders(has([Role.Restocker]))).toBe(true);
        expect(canOpenPurchaseOrders(has([Role.Admin]))).toBe(true);
        expect(canOpenPurchaseOrders(has([Role.Adjuster, Role.Seller]))).toBe(
            false,
        );
    });
});
