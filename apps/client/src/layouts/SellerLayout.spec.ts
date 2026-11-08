import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    type App,
    type Component,
    createApp,
    defineComponent,
    h,
    nextTick,
    ref,
} from 'vue';
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
import { Role } from '@grocery-pos/contracts';
import { useShiftStore } from '@/stores/shift';
import { useUIStore } from '@/stores/ui';
import { stubMatchMedia } from '@/testing/match-media';
import { anyModalOpen } from '@/components/ui/modal-stack';
import { clickLink, NEW_TAB_CLICKS } from '@/testing/link-click';
import { useRegisterShortcuts } from '@/composables/useRegisterShortcuts';
import { useStickyFocus } from '@/composables/useStickyFocus';
import SellerLayout from './SellerLayout.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

// Stores navigate with the app's router (`import('@/router')`); here that
// is the test's router, so e.g. the shift store's goToRegister really runs.
const appRouter = vi.hoisted(() => ({ current: null as Router | null }));
vi.mock('@/router', () => ({
    default: {
        push: (to: Parameters<Router['push']>[0]) =>
            appRouter.current!.push(to),
        replace: (to: Parameters<Router['replace']>[0]) =>
            appRouter.current!.replace(to),
        get currentRoute() {
            return appRouter.current!.currentRoute;
        },
    },
}));

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

async function mountAt(path: string, register: Component = Stub) {
    router = createRouter({
        history: createMemoryHistory(),
        routes: [
            {
                path: '/seller',
                component: SellerLayout,
                children: [
                    { path: '', name: 'SellerDashboard', component: Stub },
                    { path: 'register', name: 'Sell', component: register },
                    { path: 'orders', name: 'Sales', component: Stub },
                ],
            },
        ],
    });
    appRouter.current = router;
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

describe('SellerLayout toast placement (#85)', () => {
    it('puts the toasts above the Tender footer on the register, bottom-center elsewhere, and back top-right on leaving', async () => {
        api.get.mockResolvedValue({ data: { shift: SHIFT } });
        const ui = useUIStore();
        expect(ui.toastPlacement).toBe('top-right');

        await mountAt('/seller/register');
        expect(ui.toastPlacement).toBe('register');

        await router.push('/seller/orders');
        await flush();
        expect(ui.toastPlacement).toBe('bottom-center');

        await router.push('/seller');
        await flush();
        expect(ui.toastPlacement).toBe('bottom-center');

        // Leaving the seller layout (e.g. for the admin pages).
        app?.unmount();
        app = null;
        expect(ui.toastPlacement).toBe('top-right');
    });
});

describe('SellerLayout sidebar (issue #26)', () => {
    let media: ReturnType<typeof stubMatchMedia> | null = null;

    function signIn(userId: string) {
        localStorage.setItem(
            'user',
            JSON.stringify({ userId, username: 'ana', roles: [Role.Seller] }),
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
            // A rail in the page, not a dialog (#89).
            expect(sidebar().hasAttribute('role')).toBe(false);
            expect(sidebar().hasAttribute('aria-modal')).toBe(false);
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
            // The rail's account button is a 44px target too (#107).
            expect(
                sidebar()
                    .querySelector('[data-dropdown-trigger]')!
                    .className.split(/\s+/),
            ).toEqual(expect.arrayContaining(['w-11', 'h-11']));
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
            // A modal dialog while it is a drawer (#89).
            expect(sidebar().getAttribute('role')).toBe('dialog');
            expect(sidebar().getAttribute('aria-modal')).toBe('true');
            expect(sidebar().getAttribute('aria-label')).toBe(
                'Navigation menu',
            );
            // Labels are shown in the drawer, and the focus moves into it.
            expect(sidebar().textContent).toContain('Register (Sale)');
            expect(sidebar().contains(document.activeElement)).toBe(true);
        });

        function link(label: string) {
            return [
                ...sidebar().querySelectorAll<HTMLAnchorElement>('nav a'),
            ].find((a) => a.textContent?.includes(label))!;
        }

        it('renders its items as links to their pages (#143)', async () => {
            await mountAt('/seller/orders');

            expect(sidebar().querySelectorAll('nav button')).toHaveLength(0);
            expect(link('Dashboard').getAttribute('href')).toBe('/seller');
            expect(link('Register (Sale)').getAttribute('href')).toBe(
                '/seller/register',
            );
            expect(link('Sales History').getAttribute('href')).toBe(
                '/seller/orders',
            );
            expect(link('Sales History').getAttribute('aria-current')).toBe(
                'page',
            );
            expect(link('Register (Sale)').hasAttribute('aria-current')).toBe(
                false,
            );
        });

        it.each(NEW_TAB_CLICKS)(
            'leaves a %s click to the browser: no navigation, no shift check, drawer stays open (#143)',
            async (_name, init) => {
                await mountAt('/seller/orders');
                const shift = useShiftStore();
                const goToRegister = vi.spyOn(shift, 'goToRegister');
                menuButton().click();
                await flush();

                for (const label of ['Register (Sale)', 'Dashboard']) {
                    const { appTookIt } = clickLink(link(label), init);
                    await flush();
                    expect(appTookIt).toBe(false);
                }

                expect(goToRegister).not.toHaveBeenCalled();
                expect(router.currentRoute.value.name).toBe('Sales');
                expect(menuButton().getAttribute('aria-expanded')).toBe('true');
                expect(anyModalOpen.value).toBe(true);
            },
        );

        it('asks for a shift on a plain click on Register when there is none (#143)', async () => {
            await mountAt('/seller/orders');
            useShiftStore().activeShift = null;
            menuButton().click();
            await flush();

            const { appTookIt } = clickLink(link('Register (Sale)'));
            await flush();

            expect(appTookIt).toBe(true);
            expect(useShiftStore().shiftInOpen).toBe(true);
            expect(router.currentRoute.value.name).toBe('Sales');
            expect(isClosed()).toBe(true);
        });

        it('goes to the register through the shift check on a plain click (#143)', async () => {
            await mountAt('/seller/orders');
            const shift = useShiftStore();
            const goToRegister = vi.spyOn(shift, 'goToRegister');
            expect(shift.activeShift).toEqual(SHIFT);
            menuButton().click();
            await flush();

            const { appTookIt } = clickLink(link('Register (Sale)'));
            await flush();

            expect(appTookIt).toBe(true);
            expect(goToRegister).toHaveBeenCalledTimes(1);
            // With a shift open: straight to the register, no shift-in prompt.
            expect(router.currentRoute.value.name).toBe('Sell');
            expect(shift.shiftInOpen).toBe(false);
            expect(isClosed()).toBe(true);
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

            const history = [...sidebar().querySelectorAll('nav a')].find((b) =>
                b.textContent?.includes('Sales History'),
            ) as HTMLAnchorElement;
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
            expect(anyModalOpen.value).toBe(false);
        });

        /** A register with the real sticky scan box and register keys. */
        const charge = vi.fn();
        // A plain options object: the file's one defineComponent is Stub.
        const Register: Component = {
            setup() {
                const box = ref<HTMLInputElement | null>(null);
                useStickyFocus(() => box.value);
                useRegisterShortcuts({ F9: charge });
                return () =>
                    h('input', { ref: box, 'data-testid': 'scan-box' });
            },
        };

        function scanBox() {
            return document.querySelector<HTMLInputElement>(
                '[data-testid="scan-box"]',
            )!;
        }

        function key(name: string) {
            const event = new KeyboardEvent('keydown', {
                key: name,
                bubbles: true,
                cancelable: true,
            });
            (document.activeElement ?? document.body).dispatchEvent(event);
            return event;
        }

        it('is modal: the register behind it is inert and its keys pause', async () => {
            charge.mockReset();
            await mountAt('/seller/register', Register);
            menuButton().click();
            await flush();

            expect(anyModalOpen.value).toBe(true);
            expect(sidebar().contains(document.activeElement)).toBe(true);
            // The page (the app root) is inert; the drawer is not.
            expect(scanBox().closest('[inert]')).not.toBeNull();
            expect(sidebar().closest('[inert]')).toBeNull();

            // A scan's keystroke doesn't go to the scan box behind it.
            key('7');
            await flush();
            expect(document.activeElement).not.toBe(scanBox());
            expect(sidebar().contains(document.activeElement)).toBe(true);

            // Nor do the register keys.
            key('F9');
            await flush();
            expect(charge).not.toHaveBeenCalled();

            // Escape closes it through the stack; the keys work again.
            key('Escape');
            await flush();
            expect(isClosed()).toBe(true);
            expect(anyModalOpen.value).toBe(false);
            expect(scanBox().closest('[inert]')).toBeNull();
            key('F9');
            expect(charge).toHaveBeenCalledTimes(1);
        });

        it('leaves nothing behind when unmounted open', async () => {
            await mountAt('/seller/register');
            menuButton().click();
            await flush();
            expect(anyModalOpen.value).toBe(true);

            app!.unmount();
            app = null;

            expect(anyModalOpen.value).toBe(false);
            expect(document.querySelector('[inert]')).toBeNull();
            expect(document.body.style.overflow).toBe('');
        });

        it('stays on the dashboard after Back with it open, closed and not inert (#161)', async () => {
            await mountAt('/seller');
            await router.push('/seller/register');
            await flush();
            menuButton().focus();
            menuButton().click();
            await flush();
            expect(anyModalOpen.value).toBe(true);

            router.back();
            await flush();

            expect(router.currentRoute.value.name).toBe('SellerDashboard');
            expect(isClosed()).toBe(true);
            expect(anyModalOpen.value).toBe(false);
            expect(
                document.querySelector('[inert]:not(#seller-sidebar)'),
            ).toBeNull();
            expect(document.activeElement).not.toBe(document.body);
        });
    });
});

describe('SellerLayout: one navigation on every seller page (#161)', () => {
    let media: ReturnType<typeof stubMatchMedia> | null = null;

    beforeEach(() => {
        localStorage.clear();
        api.get.mockResolvedValue({ data: { shift: SHIFT } });
        media = stubMatchMedia(true);
    });

    afterEach(() => {
        media?.restore();
        media = null;
    });

    it.each(['/seller', '/seller/register', '/seller/orders'])(
        'shows the sidebar and no separate header on %s',
        async (path) => {
            await mountAt(path);
            const sidebar = document.querySelector<HTMLElement>(
                '[data-testid="seller-sidebar"]',
            )!;
            expect(sidebar).not.toBeNull();
            expect(
                document.querySelector('[data-testid="seller-nav-menu"]'),
            ).toBeNull();
            expect(
                document.querySelector('[data-testid="seller-nav-drawer"]'),
            ).toBeNull();
            expect(document.querySelectorAll('main')).toHaveLength(1);
            expect(
                [...sidebar.querySelectorAll('nav a')].map((a) =>
                    a.textContent?.trim(),
                ),
            ).toEqual(['Dashboard', 'Register (Sale)', 'Sales History']);
        },
    );

    it('marks the dashboard current on the dashboard', async () => {
        await mountAt('/seller');
        const current = document.querySelector(
            '[data-testid="seller-sidebar"] a[aria-current="page"]',
        );
        expect(current?.textContent?.trim()).toBe('Dashboard');
    });

    it('is the dark leaf sidebar with inverse focus rings and a dark profile box (#160)', async () => {
        await mountAt('/seller');
        const sidebar = document.querySelector<HTMLElement>(
            '[data-testid="seller-sidebar"]',
        )!;
        const cls = sidebar.className.split(/\s+/);
        expect(cls).toEqual(
            expect.arrayContaining(['bg-leaf-900', 'border-leaf-800']),
        );
        expect(cls).not.toContain('bg-white');
        for (const el of sidebar.querySelectorAll<HTMLElement>('a, button')) {
            const c = el.className.split(/\s+/);
            expect(c).toContain('focus-ring-inverse');
            expect(c).not.toContain('focus-ring');
            expect(c).not.toContain('outline-none');
        }
        const links = sidebar.querySelectorAll<HTMLElement>('nav a');
        for (const a of links) expect(a.className).toContain('min-h-11');
        expect(sidebar.innerHTML).not.toMatch(/slate-/);
    });
});
