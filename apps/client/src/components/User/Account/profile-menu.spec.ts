/**
 * "Change password" is in the profile menu of both layouts (#88): every
 * account menu the admin and seller layouts render offers it, and it opens
 * the change-password dialog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, type Component, createApp, defineComponent, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import {
    createMemoryHistory,
    createRouter,
    type Router,
    RouterView,
} from 'vue-router';
import { Role } from '@grocery-pos/contracts';
import type { ApiGet, ApiSend } from '@/testing/api-mock';
import { flush } from '@/testing/form-dom';
import { stubMatchMedia } from '@/testing/match-media';
import SellerLayout from '@/layouts/SellerLayout.vue';
import UserLayout from '@/layouts/UserLayout.vue';

const api = vi.hoisted(() => ({
    get: vi.fn<ApiGet>(),
    post: vi.fn<ApiSend>(),
    patch: vi.fn<ApiSend>(),
}));
vi.mock('@/axios', () => ({ default: api }));

const Stub = defineComponent({ render: () => h('div') });

let app: App | null = null;
let media: ReturnType<typeof stubMatchMedia> | null = null;

async function mountAt(layout: Component, children: string[], at: string) {
    const router: Router = createRouter({
        history: createMemoryHistory(),
        routes: [
            {
                path: '/',
                component: layout,
                children: children.map((name) => ({
                    path: name.toLowerCase(),
                    name,
                    component: Stub,
                })),
            },
            { path: '/login', name: 'Login', component: Stub },
        ],
    });
    await router.push({ name: at });
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(RouterView);
    app.use(createPinia());
    app.use(router);
    app.mount(host);
    await flush();
}

/** Opens each account menu on the page and reads its item labels. */
async function menus(): Promise<string[][]> {
    const triggers = [
        ...document.querySelectorAll<HTMLButtonElement>(
            '[data-dropdown-trigger]',
        ),
    ];
    const found: string[][] = [];
    for (const trigger of triggers) {
        trigger.click();
        await flush();
        const menu = document.getElementById(
            trigger.getAttribute('aria-controls') ?? '',
        );
        found.push(
            [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].map(
                (item) => item.textContent?.trim() ?? '',
            ),
        );
        trigger.click();
        await flush();
    }
    return found;
}

async function openChangePassword() {
    const trigger = document.querySelector<HTMLButtonElement>(
        '[data-dropdown-trigger]',
    )!;
    trigger.click();
    await flush();
    document
        .querySelector<HTMLButtonElement>('[data-testid="change-password"]')!
        .click();
    await flush();
}

/**
 * From each account menu on the page: opens the dialog through the menu
 * item, cancels it, and reports whether the focus came back to that
 * menu's account button (the item itself is gone with the menu).
 */
async function focusAfterCancel(): Promise<boolean[]> {
    const triggers = [
        ...document.querySelectorAll<HTMLButtonElement>(
            '[data-dropdown-trigger]',
        ),
    ];
    const results: boolean[] = [];
    for (const trigger of triggers) {
        trigger.focus();
        trigger.click();
        await flush();
        const menu = document.getElementById(
            trigger.getAttribute('aria-controls') ?? '',
        );
        menu?.querySelector<HTMLButtonElement>(
            '[data-testid="change-password"]',
        )?.click();
        await flush();
        expect(dialogTitle()).toBe('Change password');

        const cancel = [
            ...document.querySelectorAll<HTMLButtonElement>(
                '[role="dialog"] button',
            ),
        ].find((b) => b.textContent?.trim() === 'Cancel');
        cancel!.click();
        await flush();
        // The dialog leaves after its transition (a frame in jsdom).
        for (
            let i = 0;
            i < 20 && document.querySelector('[role="dialog"]');
            i++
        ) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(document.querySelector('[role="dialog"]')).toBeNull();

        results.push(document.activeElement === trigger);
    }
    return results;
}

function dialogTitle(): string {
    return (
        document.body
            .querySelector('[role="dialog"] h2')
            ?.textContent?.trim() ?? ''
    );
}

beforeEach(() => {
    localStorage.clear();
    media = stubMatchMedia(true);
    api.get.mockReset().mockResolvedValue({ data: { shift: null } });
});

afterEach(() => {
    app?.unmount();
    app = null;
    media?.restore();
    media = null;
    document.body.innerHTML = '';
    localStorage.clear();
});

describe('profile menu: Change password (#88)', () => {
    describe('admin layout', () => {
        beforeEach(() => {
            localStorage.setItem(
                'user',
                JSON.stringify({ username: 'boss', roles: [Role.Admin] }),
            );
            setActivePinia(createPinia());
        });

        it('offers it in every account menu, above Log out', async () => {
            await mountAt(UserLayout, ['Dashboard'], 'Dashboard');

            const found = await menus();
            expect(found.length).toBeGreaterThan(0);
            for (const items of found) {
                expect(items).toEqual(['Change password', 'Log out']);
            }
        });

        it('opens the change-password dialog', async () => {
            await mountAt(UserLayout, ['Dashboard'], 'Dashboard');

            await openChangePassword();

            expect(dialogTitle()).toBe('Change password');
        });

        it('gives the focus back to the account button on Cancel, from every menu', async () => {
            await mountAt(UserLayout, ['Dashboard'], 'Dashboard');

            const results = await focusAfterCancel();

            expect(results.length).toBeGreaterThan(0);
            expect(results.every(Boolean)).toBe(true);
        });
    });

    describe('seller layout', () => {
        beforeEach(() => {
            localStorage.setItem(
                'user',
                JSON.stringify({
                    userId: 'u1',
                    username: 'ana',
                    roles: [Role.Seller],
                }),
            );
            setActivePinia(createPinia());
        });

        it.each(['SellerDashboard', 'Sales'])(
            'offers it in every account menu on %s',
            async (at) => {
                await mountAt(SellerLayout, ['SellerDashboard', 'Sales'], at);

                const found = await menus();
                expect(found.length).toBeGreaterThan(0);
                for (const items of found) {
                    expect(items).toEqual(['Change password', 'Log out']);
                }
            },
        );

        it('opens the change-password dialog', async () => {
            await mountAt(
                SellerLayout,
                ['SellerDashboard', 'Sales'],
                'SellerDashboard',
            );

            await openChangePassword();

            expect(dialogTitle()).toBe('Change password');
        });

        it.each(['SellerDashboard', 'Sales'])(
            'gives the focus back to the account button on Cancel, on %s',
            async (at) => {
                await mountAt(SellerLayout, ['SellerDashboard', 'Sales'], at);

                const results = await focusAfterCancel();

                expect(results.length).toBeGreaterThan(0);
                expect(results.every(Boolean)).toBe(true);
            },
        );
    });
});
