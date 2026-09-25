import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, h, nextTick } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import {
    createMemoryHistory,
    createRouter,
    type Router,
    RouterView,
} from 'vue-router';
import {
    type CurrentShiftView,
    DEFAULT_TERMINAL,
    ShiftStatus,
} from '@grocery-pos/contracts';
import { useShiftStore } from '@/stores/shift';
import SellerLayout from './SellerLayout.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

const SHIFT: CurrentShiftView = {
    _id: 'shift1',
    status: ShiftStatus.OPEN,
    cashierName: 'ana',
    terminal: DEFAULT_TERMINAL,
    openedAt: '2026-09-25T00:00:00.000Z',
    openingFloat: 100_000,
    movements: [],
};

const Stub = defineComponent({ render: () => h('div') });

let app: App | null = null;
let pinia: Pinia;
let router: Router;

async function flush() {
    for (let i = 0; i < 5; i++) await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 5; i++) await nextTick();
}

async function mountAt(path: string) {
    router = createRouter({
        history: createMemoryHistory(),
        routes: [
            {
                path: '/seller',
                component: SellerLayout,
                children: [
                    { path: '', name: 'SellerDashboard', component: Stub },
                    { path: 'register', name: 'Sell', component: Stub },
                    { path: 'orders', name: 'Sales', component: Stub },
                ],
            },
        ],
    });
    await router.push(path);
    const host = document.createElement('div');
    document.body.appendChild(host);
    // The layout is the matched route component, rendered by RouterView.
    app = createApp(RouterView);
    app.use(pinia);
    app.use(router);
    app.mount(host);
    await flush();
}

beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    api.get.mockReset();
    api.post.mockReset();
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

describe('SellerLayout (shift from the server, issue #2)', () => {
    it('resumes the open shift on load and keeps the cashier on the register', async () => {
        api.get.mockResolvedValue({ data: { shift: SHIFT } });

        await mountAt('/seller/register');

        expect(api.get).toHaveBeenCalledWith('/shifts/current');
        expect(useShiftStore().activeShift).toEqual(SHIFT);
        expect(router.currentRoute.value.name).toBe('Sell');
    });

    it('sends the cashier to open a shift when the server has none', async () => {
        api.get.mockResolvedValue({ data: { shift: null } });

        await mountAt('/seller/register');

        expect(router.currentRoute.value.name).toBe('SellerDashboard');
        expect(useShiftStore().shiftInOpen).toBe(true);
    });

    it('leaves the register when the shift is closed elsewhere', async () => {
        api.get.mockResolvedValue({ data: { shift: SHIFT } });
        await mountAt('/seller/register');

        // e.g. POST /sales answered SHIFT_NOT_OPEN after an admin force-close.
        useShiftStore().shiftClosedElsewhere();
        await flush();

        expect(router.currentRoute.value.name).toBe('SellerDashboard');
        expect(useShiftStore().shiftInOpen).toBe(true);
    });

    it('does not ask for a new shift when the store is reset on logout', async () => {
        api.get.mockResolvedValue({ data: { shift: SHIFT } });
        await mountAt('/seller/register');

        useShiftStore().reset();
        await flush();

        expect(useShiftStore().shiftInOpen).toBe(false);
    });
});
