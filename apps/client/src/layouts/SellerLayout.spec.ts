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
import { stubMatchMedia } from '@/testing/match-media';
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

describe('SellerLayout sidebar (issue #26)', () => {
    let media: ReturnType<typeof stubMatchMedia> | null = null;

    function signIn(userId: string) {
        localStorage.setItem(
            'user',
            JSON.stringify({ userId, username: 'ana', roles: ['SELLER'] }),
        );
        // The auth store reads the cached user when it is created.
        pinia = createPinia();
        setActivePinia(pinia);
    }

    function sidebar() {
        return document.querySelector<HTMLElement>(
            '[data-testid="seller-sidebar"]',
        )!;
    }

    function backdrop() {
        return document.querySelector<HTMLElement>(
            '[data-testid="sidebar-backdrop"]',
        );
    }

    /** Closed: off screen and inert (the backdrop may still fade out). */
    function isClosed() {
        return (
            menuButton().getAttribute('aria-expanded') === 'false' &&
            sidebar().hasAttribute('inert') &&
            sidebar().className.includes('-translate-x-full')
        );
    }

    function menuButton() {
        return document.querySelector<HTMLButtonElement>(
            '[data-testid="seller-menu"]',
        )!;
    }

    beforeEach(() => {
        localStorage.clear();
        api.get.mockResolvedValue({ data: { shift: SHIFT } });
    });

    afterEach(() => {
        media?.restore();
        media = null;
        localStorage.clear();
    });

    describe('at lg and up', () => {
        beforeEach(() => {
            media = stubMatchMedia(true);
        });

        it('starts expanded, with its labels', async () => {
            signIn('u1');
            await mountAt('/seller/register');

            expect(sidebar().textContent).toContain('Register (Sale)');
            expect(sidebar().className).toContain('lg:w-64');
            expect(sidebar().hasAttribute('inert')).toBe(false);
            expect(
                document.querySelector('[data-testid="sidebar-collapse"]'),
            ).not.toBeNull();
        });

        it('remembers a collapse for this user on this device', async () => {
            signIn('u1');
            await mountAt('/seller/register');

            document
                .querySelector<HTMLButtonElement>(
                    '[data-testid="sidebar-collapse"]',
                )!
                .click();
            await flush();

            expect(sidebar().className).toContain('lg:w-20');
            expect(sidebar().textContent).not.toContain('Register (Sale)');
            expect(localStorage.getItem('grocery_pos_sidebar_v1:u1')).toBe(
                'collapsed',
            );

            // A reload: still collapsed for u1, expanded for someone else.
            app!.unmount();
            signIn('u1');
            await mountAt('/seller/register');
            expect(sidebar().className).toContain('lg:w-20');

            app!.unmount();
            signIn('u2');
            await mountAt('/seller/register');
            expect(sidebar().className).toContain('lg:w-64');
        });

        it('is expanded when localStorage fails', async () => {
            signIn('u1');
            localStorage.setItem('grocery_pos_sidebar_v1:u1', 'collapsed');
            const original = Storage.prototype.getItem;
            vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
                this: Storage,
                key: string,
            ) {
                if (key.startsWith('grocery_pos_sidebar_v1:')) {
                    throw new DOMException('blocked', 'SecurityError');
                }
                return original.call(this, key);
            });
            await mountAt('/seller/register');

            expect(sidebar().className).toContain('lg:w-64');
            expect(sidebar().textContent).toContain('Register (Sale)');
        });
    });

    describe('below lg: a drawer', () => {
        beforeEach(() => {
            media = stubMatchMedia(false);
            signIn('u1');
        });

        it('is hidden until the menu button opens it', async () => {
            await mountAt('/seller/register');

            expect(sidebar().hasAttribute('inert')).toBe(true);
            expect(sidebar().className).toContain('-translate-x-full');
            expect(backdrop()).toBeNull();

            menuButton().click();
            await flush();

            expect(sidebar().hasAttribute('inert')).toBe(false);
            expect(sidebar().className).toContain('translate-x-0');
            expect(backdrop()).not.toBeNull();
            expect(menuButton().getAttribute('aria-expanded')).toBe('true');
            // Labels are shown in the drawer, and the focus moves into it.
            expect(sidebar().textContent).toContain('Register (Sale)');
            expect(sidebar().contains(document.activeElement)).toBe(true);
        });

        it('ignores a stored collapse: the drawer shows its labels', async () => {
            localStorage.setItem('grocery_pos_sidebar_v1:u1', 'collapsed');
            await mountAt('/seller/register');
            menuButton().click();
            await flush();

            expect(sidebar().textContent).toContain('Register (Sale)');
        });

        it('closes on Escape and gives the focus back', async () => {
            await mountAt('/seller/register');
            menuButton().focus();
            menuButton().click();
            await flush();

            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
            );
            await flush();

            expect(isClosed()).toBe(true);
            expect(document.activeElement).toBe(menuButton());
        });

        it('closes on the backdrop', async () => {
            await mountAt('/seller/register');
            menuButton().click();
            await flush();

            backdrop()!.click();
            await flush();

            expect(isClosed()).toBe(true);
        });

        it('closes on navigation', async () => {
            await mountAt('/seller/register');
            menuButton().click();
            await flush();

            const history = [...sidebar().querySelectorAll('nav button')].find(
                (b) => b.textContent?.includes('Sales History'),
            ) as HTMLButtonElement;
            history.click();
            await flush();

            expect(router.currentRoute.value.name).toBe('Sales');
            expect(isClosed()).toBe(true);
        });

        it('closes when the window grows to lg', async () => {
            await mountAt('/seller/register');
            menuButton().click();
            await flush();

            media!.set(true);
            await flush();

            expect(menuButton().getAttribute('aria-expanded')).toBe('false');
            expect(sidebar().hasAttribute('inert')).toBe(false);
        });
    });
});
