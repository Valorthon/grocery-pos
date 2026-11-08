import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, type Slots, createApp, defineComponent, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { Role } from '@grocery-pos/contracts';
import { flush } from '@/testing/form-dom';
import { useAuthStore } from '@/stores/auth';
import NotFound from './NotFound.vue';
import { notFoundLink } from './not-found-link';
import { pageTitle } from '@/router/page-title';

vi.mock('@/axios', () => ({ default: { post: vi.fn(), get: vi.fn() } }));

// The real layouts need stores and the API; a stub with the same slot
// shows which frame the page picked (#193).
function layoutStub(name: string) {
    return {
        __esModule: true,
        default: {
            render(this: { $slots: Slots }) {
                return h('div', { 'data-stub-layout': name }, [
                    h('main', this.$slots.default?.()),
                ]);
            },
        },
    };
}
vi.mock('@/layouts/UserLayout.vue', () => layoutStub('user'));
vi.mock('@/layouts/SellerLayout.vue', () => layoutStub('seller'));

const Blank = defineComponent({ render: () => null });
let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
    localStorage.clear();
});

async function mount(roles: Role[] | null) {
    const pinia = createPinia();
    setActivePinia(pinia);
    const auth = useAuthStore();
    auth.user = roles ? ({ username: 'u', roles } as never) : null;
    Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => (roles ? 'dummy=true' : ''),
    });
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/login', name: 'Login', component: Blank },
            { path: '/admin', name: 'Dashboard', component: Blank },
            { path: '/seller', name: 'SellerDashboard', component: Blank },
            { path: '/:p(.*)*', name: 'NotFound', component: NotFound },
        ],
    });
    await router.push('/nope');
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(NotFound).use(pinia).use(router);
    app.mount(host);
    await flush();
    return host;
}

describe('NotFound view (#162)', () => {
    it('has one h1 and a Log in link when logged out', async () => {
        const host = await mount(null);
        expect(host.querySelectorAll('h1')).toHaveLength(1);
        expect(host.querySelector('h1')?.textContent).toBe('Page not found');
        const link = host.querySelector('a');
        expect(link?.textContent).toBe('Log in');
        expect(link?.getAttribute('href')).toBe('/login');
        expect(link?.className).toContain('focus-ring');
        expect(link?.className).not.toContain('outline-none');
        expect(host.querySelector('[data-stub-layout]')).toBeNull();
        expect(host.querySelectorAll('main')).toHaveLength(1);
    });

    it('renders inside the admin layout for a manager (#193)', async () => {
        const host = await mount([Role.Admin]);
        const frame = host.querySelector('[data-stub-layout]');
        expect(frame?.getAttribute('data-stub-layout')).toBe('user');
        expect(frame?.querySelector('h1')?.textContent).toBe('Page not found');
        expect(host.querySelectorAll('main')).toHaveLength(1);
        expect(host.querySelectorAll('h1')).toHaveLength(1);
    });

    it('renders inside the seller layout for a cashier (#193)', async () => {
        const host = await mount([Role.Seller]);
        const frame = host.querySelector('[data-stub-layout]');
        expect(frame?.getAttribute('data-stub-layout')).toBe('seller');
        expect(frame?.querySelector('a')?.textContent).toBe('Go to register');
    });

    it('links an admin to the dashboard', async () => {
        const host = await mount([Role.Admin]);
        const link = host.querySelector('a');
        expect(link?.textContent).toBe('Go to dashboard');
        expect(link?.getAttribute('href')).toBe('/admin');
    });

    it('links a cashier to the register', async () => {
        const host = await mount([Role.Seller]);
        const link = host.querySelector('a');
        expect(link?.textContent).toBe('Go to register');
        expect(link?.getAttribute('href')).toBe('/seller');
    });
});

describe('pageTitle', () => {
    it('names the page before the app', () => {
        expect(pageTitle('Low stock')).toBe('Low stock · Grocery POS');
        expect(pageTitle()).toBe('Grocery POS');
    });
});

describe('notFoundLink', () => {
    it('follows homeRouteFor for a session', () => {
        expect(notFoundLink(true, [Role.UserManager]).to).toEqual({
            name: 'Dashboard',
        });
        expect(notFoundLink(true, [Role.Seller, Role.Admin]).label).toBe(
            'Go to dashboard',
        );
    });

    it('offers Log in to a session that opens no page', () => {
        expect(notFoundLink(true, [])).toEqual({
            to: { name: 'Login' },
            label: 'Log in',
        });
    });
});
