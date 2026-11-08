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
import { clickLink, NEW_TAB_CLICKS } from '@/testing/link-click';
import UserLayout from './UserLayout.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

const Stub = defineComponent({
    render: () => h('input', { 'data-testid': 'page-field' }),
});

/** Every page the admin sidebar and app bar link to. */
const PAGES = [
    ['', 'Dashboard'],
    ['settings', 'Settings'],
    ['audit', 'AuditLog'],
    ['reports', 'Reports'],
    ['sales', 'SalesHistory'],
    ['shifts', 'Shifts'],
    ['suppliers', 'Suppliers'],
    ['purchase-orders', 'PurchaseOrders'],
    ['categories', 'Categories'],
    ['stock-counts', 'StockCounts'],
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
    return [...sidebar().querySelectorAll('nav a')].find((b) =>
        b.textContent?.includes(label),
    ) as HTMLAnchorElement;
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

describe('UserLayout sidebar section headings (#143)', () => {
    beforeEach(() => {
        media = stubMatchMedia(true);
    });
    const headings = () =>
        [...sidebar().querySelectorAll('nav > div.uppercase')].map((d) =>
            d.textContent?.trim(),
        );

    it('shows no heading over a section with no item for the user', async () => {
        localStorage.setItem(
            'user',
            JSON.stringify({
                userId: 'r1',
                username: 'stock',
                roles: [Role.Restocker],
            }),
        );
        await mountAt('/admin/products');
        expect(headings()).toEqual(['Overview', 'Stock', 'Purchasing']);
    });

    it('keeps the Admin heading for an admin', async () => {
        await mountAt('/admin/products');
        expect(headings()).toContain('Admin');
    });

    it('groups the entries by task, in order (#160)', async () => {
        await mountAt('/admin/products');
        expect(headings()).toEqual([
            'Overview',
            'Sales',
            'Stock',
            'Purchasing',
            'Admin',
        ]);
        const groups: string[][] = [];
        for (const el of sidebar().querySelector('nav')!.children) {
            if (el.tagName === 'DIV') groups.push([]);
            else if ((el as HTMLElement).style.display !== 'none')
                groups[groups.length - 1].push(
                    el.textContent!.replace(/\d+|\?/g, '').trim(),
                );
        }
        expect(groups).toEqual([
            ['Dashboard'],
            ['Sales History', 'Shifts', 'Sales Reports'],
            [
                'Product List',
                'Inventory',
                'Low Stock',
                'Stock Counts',
                'Adjustment History',
            ],
            ['Purchase Orders', 'Restock History', 'Suppliers', 'Categories'],
            ['Users', 'Roles', 'Audit Log', 'Store Settings'],
        ]);
    });
});

describe('UserLayout sidebar entries per role (#160)', () => {
    beforeEach(() => {
        media = stubMatchMedia(true);
    });
    const visible = () =>
        [...sidebar().querySelectorAll<HTMLElement>('nav a')]
            .filter((a) => a.style.display !== 'none')
            .map((a) => a.textContent!.replace(/\d+|\?/g, '').trim());

    it.each([
        [
            Role.Restocker,
            [
                'Dashboard',
                'Product List',
                'Inventory',
                'Low Stock',
                'Purchase Orders',
                'Restock History',
                'Suppliers',
            ],
        ],
        [
            Role.Adjuster,
            [
                'Dashboard',
                'Product List',
                'Inventory',
                'Low Stock',
                'Stock Counts',
                'Adjustment History',
            ],
        ],
        [Role.UserManager, ['Dashboard', 'Users', 'Roles']],
        [
            Role.Admin,
            [
                'Dashboard',
                'Sales History',
                'Shifts',
                'Sales Reports',
                'Product List',
                'Inventory',
                'Low Stock',
                'Stock Counts',
                'Adjustment History',
                'Purchase Orders',
                'Restock History',
                'Suppliers',
                'Categories',
                'Users',
                'Roles',
                'Audit Log',
                'Store Settings',
            ],
        ],
    ])('shows %s exactly its entries', async (role, entries) => {
        localStorage.setItem(
            'user',
            JSON.stringify({
                userId: 'u1',
                username: 'someone',
                roles: [role],
            }),
        );
        await mountAt('/admin/products');
        expect(visible()).toEqual(entries);
    });
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

describe('UserLayout app bar targets (#107)', () => {
    function classes(el: Element | null | undefined): string[] {
        expect(el).toBeTruthy();
        return el!.className.split(/\s+/);
    }

    for (const large of [false, true]) {
        it(`makes every app bar button at least 44px ${large ? 'from' : 'below'} lg`, async () => {
            media = stubMatchMedia(large);
            await mountAt('/admin/products');
            const header = document.querySelector('header')!;

            for (const label of [
                'Add Product',
                'Restock Inventory',
                'Adjust Stock',
            ]) {
                const button = header.querySelector(
                    `button[aria-label="${label}"]`,
                );
                expect(classes(button)).toEqual(
                    expect.arrayContaining(['min-h-11', 'min-w-11']),
                );
                expect(classes(button)).not.toContain('p-2');
                // A visible label from lg up, icon-only below (#160).
                const text = button!.querySelector('span')!;
                expect(classes(text)).toEqual([
                    'hidden',
                    'lg:inline',
                    'whitespace-nowrap',
                ]);
                expect(
                    button!
                        .getAttribute('aria-label')!
                        .startsWith(text.textContent!.trim()),
                ).toBe(true);
            }
            expect(
                classes(header.querySelector('[data-dropdown-trigger]')),
            ).toContain('min-h-11');
        });
    }

    it('tightens its spacing below sm only, so it fits at 320px', async () => {
        media = stubMatchMedia(false);
        await mountAt('/admin/products');
        const header = document.querySelector('header')!;
        const [left, right] = [...header.children];

        expect(classes(header)).toEqual(
            expect.arrayContaining(['px-2', 'sm:px-4']),
        );
        expect(classes(left)).toEqual(
            expect.arrayContaining(['gap-2', 'sm:gap-3']),
        );
        expect(classes(right)).toEqual(
            expect.arrayContaining(['gap-1', 'sm:gap-2']),
        );
        expect(
            classes(header.querySelector('[data-dropdown-trigger]')),
        ).toEqual(
            expect.arrayContaining([
                'px-1.5',
                'sm:px-2.5',
                'gap-1',
                'sm:gap-2',
            ]),
        );
    });

    it('uses the dark profile tone in the sidebar only, and truncates the bar name (#160)', async () => {
        media = stubMatchMedia(true);
        await mountAt('/admin/products');
        const box = classes(sidebar().querySelector('[data-dropdown-trigger]'));
        expect(box).toEqual(
            expect.arrayContaining(['bg-leaf-800', 'focus-ring-inverse']),
        );
        expect(box).not.toContain('bg-white');
        const bar = document
            .querySelector('header')!
            .querySelector('[data-dropdown-trigger]')!;
        expect(classes(bar)).toContain('focus-ring');
        const name = [...bar.querySelectorAll('span')].find((el) =>
            el.className.includes('max-w-32'),
        )!;
        expect(classes(name)).toEqual(
            expect.arrayContaining(['max-w-32', 'truncate']),
        );
        expect(name.getAttribute('title')).toBe(name.textContent!.trim());
    });

    it('gives the rail account button 44px when collapsed', async () => {
        media = stubMatchMedia(true);
        await mountAt('/admin/products');
        document
            .querySelector<HTMLButtonElement>(
                '[data-testid="admin-sidebar-collapse"]',
            )!
            .click();
        await flush();

        expect(
            classes(sidebar().querySelector('[data-dropdown-trigger]')),
        ).toEqual(expect.arrayContaining(['w-11', 'h-11']));
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

describe('UserLayout sidebar items are links (#143)', () => {
    function links() {
        return [...sidebar().querySelectorAll<HTMLAnchorElement>('nav a')];
    }

    it('renders every item as an anchor with its route as href', async () => {
        media = stubMatchMedia(true);
        await mountAt('/admin/products');

        // No item is a button any more: each can open in a new tab.
        expect(sidebar().querySelectorAll('nav button')).toHaveLength(0);
        const hrefs = Object.fromEntries(
            links().map((a) => [
                a.textContent?.replace(/\d+|\?/g, '').trim(),
                a.getAttribute('href'),
            ]),
        );
        expect(hrefs).toMatchObject({
            Dashboard: '/admin',
            'Audit Log': '/admin/audit',
            'Product List': '/admin/products',
            Inventory: '/admin/inventories',
            'Low Stock': '/admin/inventories?lowStock=true',
            'Restock History': '/admin/restocks',
            Users: '/admin/users',
        });
        // Every item is still a 44px target.
        for (const a of links()) {
            expect(a.className).toMatch(/\bmin-h-11\b/);
        }
    });

    it('marks only the current page, telling Low Stock from Inventory', async () => {
        media = stubMatchMedia(true);
        await mountAt('/admin/inventories?lowStock=true');

        const current = links().filter(
            (a) => a.getAttribute('aria-current') === 'page',
        );
        expect(current).toHaveLength(1);
        expect(current[0].textContent).toContain('Low Stock');
        expect(current[0].className.split(/\s+/)).toEqual(
            expect.arrayContaining(['bg-leaf-700', 'text-white']),
        );
        const inventory = navButton('Inventory').className.split(/\s+/);
        expect(inventory).not.toContain('bg-leaf-700');
        expect(inventory).not.toContain('text-white');
    });

    it('keeps a link per item in the collapsed rail, labelled', async () => {
        media = stubMatchMedia(true);
        await mountAt('/admin/products');
        document
            .querySelector<HTMLButtonElement>(
                '[data-testid="admin-sidebar-collapse"]',
            )!
            .click();
        await flush();

        const restocks = links().find(
            (a) => a.getAttribute('aria-label') === 'Restock History',
        )!;
        expect(restocks.getAttribute('href')).toBe('/admin/restocks');
    });

    describe('below lg', () => {
        beforeEach(() => {
            media = stubMatchMedia(false);
        });

        it('navigates in this tab and closes the drawer on a plain click', async () => {
            await mountAt('/admin/products');
            menuButton().click();
            await flush();

            const { appTookIt } = clickLink(navButton('Low Stock'));
            await flush();

            expect(appTookIt).toBe(true);
            expect(router.currentRoute.value.fullPath).toBe(
                '/admin/inventories?lowStock=true',
            );
            expect(isClosed()).toBe(true);
        });

        it.each(NEW_TAB_CLICKS)(
            'leaves a %s click to the browser: no navigation here, drawer stays open',
            async (_name, init) => {
                await mountAt('/admin/products');
                menuButton().click();
                await flush();

                const { appTookIt } = clickLink(
                    navButton('Restock History'),
                    init,
                );
                await flush();

                expect(appTookIt).toBe(false);
                expect(router.currentRoute.value.name).toBe('Products');
                expect(menuButton().getAttribute('aria-expanded')).toBe('true');
                expect(anyModalOpen.value).toBe(true);
            },
        );

        it('goes through the router guards on a plain click', async () => {
            await mountAt('/admin/products');
            // e.g. the unsaved-drafts guard answering "Stay".
            const guard = vi.fn(() => false);
            router.beforeEach(guard);
            menuButton().click();
            await flush();

            const { appTookIt } = clickLink(navButton('Restock History'));
            await flush();

            expect(appTookIt).toBe(true);
            expect(guard).toHaveBeenCalledTimes(1);
            expect(router.currentRoute.value.name).toBe('Products');
        });
    });
});
