import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, h, nextTick } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import {
    createMemoryHistory,
    createRouter,
    type Router,
    RouterView,
} from 'vue-router';
import { Role } from '@grocery-pos/contracts';
import { stubMatchMedia } from '@/testing/match-media';
import { anyModalOpen } from '@/components/ui/modal-stack';
import UserLayout from './UserLayout.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

const Stub = defineComponent({
    render: () => h('input', { 'data-testid': 'page-field' }),
});

/** Every page the admin sidebar and app bar link to. */
const PAGES = [
    ['', 'Dashboard'],
    ['sales', 'SalesHistory'],
    ['shifts', 'Shifts'],
    ['products', 'Products'],
    ['products/add', 'Products/Add'],
    ['inventories', 'Inventories'],
    ['restocks', 'Restocks'],
    ['restocks/add', 'Restocks/Add'],
    ['adjustments', 'Adjustments'],
    ['adjustments/add', 'Adjustments/Add'],
    ['users', 'Users'],
    ['roles', 'Roles'],
] as const;

let app: App | null = null;
let pinia: Pinia;
let router: Router;
let media: ReturnType<typeof stubMatchMedia> | null = null;

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
                path: '/admin',
                component: UserLayout,
                children: PAGES.map(([p, name]) => ({
                    path: p,
                    name,
                    component: Stub,
                })),
            },
            // Another layout (e.g. the seller's), reached by Back.
            {
                path: '/elsewhere',
                name: 'Elsewhere',
                // A plain options object: the file's one defineComponent is Stub.
                component: { render: () => h('main', 'Elsewhere') },
            },
        ],
    });
    await router.push(path);
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(RouterView);
    app.use(pinia);
    app.use(router);
    app.mount(host);
    await flush();
}

function sidebar() {
    return document.querySelector<HTMLElement>(
        '[data-testid="admin-sidebar"]',
    )!;
}

function menuButton() {
    return document.querySelector<HTMLButtonElement>(
        '[data-testid="admin-menu"]',
    )!;
}

function backdrop() {
    return document.querySelector<HTMLElement>(
        '[data-testid="admin-sidebar-backdrop"]',
    );
}

/** The app root: RouterView's host, the first child of `<body>`. */
function appRoot() {
    return document.body.firstElementChild as HTMLElement;
}

function navButton(label: string) {
    return [...sidebar().querySelectorAll('nav button')].find((b) =>
        b.textContent?.includes(label),
    ) as HTMLButtonElement;
}

function escape() {
    document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
}

/** Closed: off screen, inert, and off the modal stack. */
function isClosed() {
    return (
        menuButton().getAttribute('aria-expanded') === 'false' &&
        sidebar().hasAttribute('inert') &&
        sidebar().className.includes('-translate-x-full') &&
        !anyModalOpen.value &&
        !appRoot().hasAttribute('inert')
    );
}

beforeEach(() => {
    localStorage.setItem(
        'user',
        JSON.stringify({ userId: 'a1', username: 'root', roles: [Role.Admin] }),
    );
    pinia = createPinia();
    setActivePinia(pinia);
    api.get.mockReset();
    api.post.mockReset();
});

afterEach(() => {
    app?.unmount();
    app = null;
    media?.restore();
    media = null;
    document.body.innerHTML = '';
    localStorage.clear();
});

describe('UserLayout sidebar at lg and up', () => {
    beforeEach(() => {
        media = stubMatchMedia(true);
    });

    it('is a rail in the page, never inert, that collapses and expands', async () => {
        await mountAt('/admin/products');

        expect(appRoot().contains(sidebar())).toBe(true);
        expect(sidebar().hasAttribute('inert')).toBe(false);
        expect(sidebar().className).toContain('lg:w-64');
        expect(sidebar().textContent).toContain('Product List');
        // A rail in the page, not a dialog.
        expect(sidebar().hasAttribute('role')).toBe(false);
        expect(sidebar().hasAttribute('aria-modal')).toBe(false);
        expect(sidebar().hasAttribute('aria-label')).toBe(false);
        expect(
            document.querySelector('[data-testid="admin-sidebar-close"]'),
        ).toBeNull();

        document
            .querySelector<HTMLButtonElement>(
                '[data-testid="admin-sidebar-collapse"]',
            )!
            .click();
        await flush();
        expect(sidebar().className).toContain('lg:w-20');
        expect(sidebar().textContent).not.toContain('Product List');
        expect(navButton('').getAttribute('aria-label')).toBe('Dashboard');

        document
            .querySelector<HTMLButtonElement>(
                '[data-testid="admin-sidebar-expand"]',
            )!
            .click();
        await flush();
        expect(sidebar().className).toContain('lg:w-64');
        expect(anyModalOpen.value).toBe(false);
    });
});

describe('UserLayout sidebar below lg: a drawer (#89)', () => {
    beforeEach(() => {
        media = stubMatchMedia(false);
    });

    it('is hidden and out of the tab order until the 44px menu button opens it', async () => {
        await mountAt('/admin/products');

        expect(menuButton().className.split(/\s+/)).toEqual(
            expect.arrayContaining(['min-h-11', 'min-w-11', 'lg:hidden']),
        );
        expect(menuButton().getAttribute('aria-controls')).toBe(
            'admin-sidebar',
        );
        expect(sidebar().id).toBe('admin-sidebar');
        expect(sidebar().hasAttribute('inert')).toBe(true);
        expect(sidebar().getAttribute('aria-hidden')).toBe('true');
        expect(sidebar().className).toContain('-translate-x-full');
        expect(backdrop()).toBeNull();

        menuButton().click();
        await flush();

        expect(menuButton().getAttribute('aria-expanded')).toBe('true');
        expect(sidebar().hasAttribute('inert')).toBe(false);
        expect(sidebar().getAttribute('role')).toBe('dialog');
        expect(sidebar().getAttribute('aria-modal')).toBe('true');
        expect(sidebar().getAttribute('aria-label')).toBe('Navigation menu');
        expect(sidebar().className).toContain('translate-x-0');
        expect(backdrop()).not.toBeNull();
        expect(anyModalOpen.value).toBe(true);
        // Under <body>, beside the page, which is inert behind it.
        expect(appRoot().contains(sidebar())).toBe(false);
        expect(appRoot().hasAttribute('inert')).toBe(true);
        expect(sidebar().closest('[inert]')).toBeNull();
        // Its labels show, and the focus moves to its first link.
        expect(sidebar().textContent).toContain('Product List');
        expect(document.activeElement).toBe(navButton('Dashboard'));
        // Every item is a 44px target.
        expect(navButton('Roles').className).toMatch(/\bmin-h-11\b/);
    });

    it('shows its labels and an X, not the rail toggle', async () => {
        await mountAt('/admin/products');
        menuButton().click();
        await flush();

        const close = document.querySelector<HTMLButtonElement>(
            '[data-testid="admin-sidebar-close"]',
        )!;
        expect(close.className.split(/\s+/)).toEqual(
            expect.arrayContaining(['min-h-11', 'min-w-11']),
        );
        expect(
            document.querySelector('[data-testid="admin-sidebar-collapse"]'),
        ).toBeNull();

        close.click();
        await flush();
        expect(isClosed()).toBe(true);
    });

    it('closes on Escape and gives the focus back to the menu button', async () => {
        await mountAt('/admin/products');
        menuButton().focus();
        menuButton().click();
        await flush();

        escape();
        await flush();

        expect(isClosed()).toBe(true);
        expect(document.activeElement).toBe(menuButton());
    });

    it('gives the focus back to the menu button even when a click did not focus it', async () => {
        await mountAt('/admin/products');
        (document.activeElement as HTMLElement | null)?.blur();
        menuButton().click();
        await flush();

        escape();
        await flush();

        expect(document.activeElement).toBe(menuButton());
    });

    it('keeps Tab inside the drawer', async () => {
        await mountAt('/admin/products');
        menuButton().click();
        await flush();

        // Shift+Tab from its first control (the X) wraps to its last one.
        document
            .querySelector<HTMLButtonElement>(
                '[data-testid="admin-sidebar-close"]',
            )!
            .focus();
        const event = new KeyboardEvent('keydown', {
            key: 'Tab',
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        });
        document.activeElement!.dispatchEvent(event);
        await flush();

        expect(event.defaultPrevented).toBe(true);
        expect(sidebar().contains(document.activeElement)).toBe(true);
    });

    it('closes on the backdrop', async () => {
        await mountAt('/admin/products');
        menuButton().click();
        await flush();

        backdrop()!.click();
        await flush();

        expect(isClosed()).toBe(true);
    });

    it('closes on navigation', async () => {
        await mountAt('/admin/products');
        menuButton().click();
        await flush();

        navButton('Restock History').click();
        await flush();

        expect(router.currentRoute.value.name).toBe('Restocks');
        expect(isClosed()).toBe(true);
    });

    it('closes on navigation from outside it too (the app bar)', async () => {
        await mountAt('/admin/products');
        menuButton().click();
        await flush();

        await router.push({ name: 'Users' });
        await flush();

        expect(isClosed()).toBe(true);
    });

    it('closes when the window grows to lg, and is a rail again', async () => {
        await mountAt('/admin/products');
        menuButton().click();
        await flush();

        media!.set(true);
        await flush();

        expect(menuButton().getAttribute('aria-expanded')).toBe('false');
        expect(anyModalOpen.value).toBe(false);
        expect(appRoot().hasAttribute('inert')).toBe(false);
        expect(sidebar().hasAttribute('inert')).toBe(false);
        expect(appRoot().contains(sidebar())).toBe(true);
    });

    it('leaves nothing behind when unmounted open', async () => {
        await mountAt('/admin/products');
        menuButton().click();
        await flush();
        expect(anyModalOpen.value).toBe(true);

        app!.unmount();
        app = null;

        expect(anyModalOpen.value).toBe(false);
        expect(document.querySelector('[inert]')).toBeNull();
        expect(document.body.style.overflow).toBe('');
    });

    it('sends the focus to <main>, not <body>, when Back leaves the layout with it open', async () => {
        await mountAt('/elsewhere');
        await router.push('/admin/products');
        await flush();
        menuButton().focus();
        menuButton().click();
        await flush();
        expect(anyModalOpen.value).toBe(true);

        router.back();
        await flush();

        expect(router.currentRoute.value.name).toBe('Elsewhere');
        expect(
            document.querySelector('[data-testid="admin-sidebar"]'),
        ).toBeNull();
        expect(anyModalOpen.value).toBe(false);
        expect(document.querySelector('[inert]')).toBeNull();
        expect(document.body.style.overflow).toBe('');
        expect(document.activeElement?.tagName).toBe('MAIN');
        expect(document.activeElement?.textContent).toBe('Elsewhere');
    });
});
