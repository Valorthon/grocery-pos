import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h } from 'vue';
import { createPinia } from 'pinia';
import { flush } from '@/testing/form-dom';
import {
    pushModal,
    removeModal,
    type ModalEntry,
} from '@/components/ui/modal-stack';
import UserProfileMenu from './UserProfileMenu.vue';

const auth = vi.hoisted(() => ({
    user: { username: 'admin', roles: ['ADMIN'] },
    requestLogout: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }));
vi.mock('@/axios', () => ({ default: { post: vi.fn(), patch: vi.fn() } }));

let app: App | null = null;
let entry: ModalEntry | null = null;
afterEach(() => {
    if (entry) removeModal(entry);
    entry = null;
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    auth.requestLogout.mockClear();
});

/**
 * The menu at the bottom of a sidebar, in a clipping box (#298); with
 * `drawer`, the sidebar is an open modal drawer on the modal stack.
 */
async function mount(drawer = false) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({
        render: () =>
            h(
                'aside',
                {
                    id: 'sidebar',
                    class: 'overflow-hidden',
                    role: drawer ? 'dialog' : undefined,
                    'aria-modal': drawer ? 'true' : undefined,
                },
                [h(UserProfileMenu, { variant: 'box', tone: 'dark' })],
            ),
    });
    app.use(createPinia());
    app.mount(host);
    if (drawer) {
        entry = {
            root: () => host,
            panel: () => document.getElementById('sidebar'),
            closable: () => true,
            close: () => undefined,
            opener: null,
        };
        pushModal(entry);
    }
    await flush();
}
const trigger = () =>
    document.querySelector<HTMLButtonElement>('[data-dropdown-trigger]')!;
const menu = () => document.querySelector<HTMLElement>('[role=menu]');
const item = (text: string) =>
    [...menu()!.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].find(
        (b) => b.textContent?.trim() === text,
    )!;
function at(y: number) {
    vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue(
        DOMRect.fromRect({ x: 10, y, width: 230, height: 52 }),
    );
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(160);
}

describe('UserProfileMenu (#298)', () => {
    it('floats outside the sidebar and opens above a trigger at the bottom', async () => {
        await mount();
        at(window.innerHeight - 60);
        trigger().click();
        await flush();
        expect(menu()).not.toBeNull();
        expect(menu()!.className).toContain('fixed');
        expect(document.getElementById('sidebar')!.contains(menu())).toBe(
            false,
        );
        expect(menu()!.dataset.placement).toBe('above');
        expect(menu()!.style.bottom).not.toBe('');
    });

    it('opens below a trigger at the top (the app bar)', async () => {
        await mount();
        at(8);
        trigger().click();
        await flush();
        expect(menu()!.dataset.placement).toBe('below');
        expect(menu()!.style.top).not.toBe('');
    });

    it('stays live on top of an open drawer: focus, Log out', async () => {
        await mount(true);
        at(window.innerHeight - 60);
        trigger().focus();
        trigger().dispatchEvent(
            new MouseEvent('click', { bubbles: true, detail: 0 }),
        );
        await flush();
        const panel = menu()!;
        expect(panel.closest('[inert]')).toBeNull();
        expect(panel.hasAttribute('data-inert-exempt')).toBe(true);
        // The drawer's focus trap does not pull the focus back out.
        expect(document.activeElement).toBe(item('Change password'));
        item('Log out').click();
        await flush();
        expect(auth.requestLogout).toHaveBeenCalledOnce();
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
    });

    it('opens Change password from the drawer', async () => {
        await mount(true);
        at(window.innerHeight - 60);
        trigger().click();
        await flush();
        item('Change password').click();
        await flush();
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
        const dialog = [
            ...document.querySelectorAll<HTMLElement>('[role=dialog]'),
        ].find((d) => d.id !== 'sidebar');
        expect(dialog?.textContent).toContain('Change password');
    });

    it('is not exempt from the inert background outside a modal', async () => {
        await mount();
        trigger().click();
        await flush();
        expect(menu()!.hasAttribute('data-inert-exempt')).toBe(false);
    });
});
