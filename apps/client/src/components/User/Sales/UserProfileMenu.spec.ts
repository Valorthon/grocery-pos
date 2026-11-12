import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, Teleport, createApp, h, ref } from 'vue';
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
    drawerClose.mockClear();
});

/**
 * The menu at the bottom of a sidebar, in a clipping box (#298); with
 * `drawer`, the sidebar is an open modal drawer on the modal stack.
 */
const large = ref(true);
const drawerClose = vi.fn();

/**
 * Like UserSidebar: from lg the sidebar is in the page; below lg it is
 * teleported under <body> (after anything already there) as a modal drawer
 * on the modal stack.
 */
async function mount(drawer = false, variant: 'box' | 'icon' | 'bar' = 'box') {
    large.value = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({
        render: () =>
            h(Teleport, { to: 'body', disabled: large.value }, [
                h(
                    'div',
                    { id: 'drawer-root' },
                    h(
                        'aside',
                        {
                            id: 'sidebar',
                            class: 'overflow-hidden',
                            role: large.value ? undefined : 'dialog',
                            'aria-modal': large.value ? undefined : 'true',
                        },
                        [
                            h('a', { href: '#' }, 'Dashboard'),
                            h(UserProfileMenu, { variant, tone: 'dark' }),
                            h('button', { type: 'button' }, 'Collapse'),
                        ],
                    ),
                ),
            ]),
    });
    app.use(createPinia());
    app.mount(host);
    await flush();
    if (drawer) {
        large.value = false;
        await flush();
        entry = {
            root: () => document.getElementById('drawer-root'),
            panel: () => document.getElementById('sidebar'),
            closable: () => true,
            close: drawerClose,
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
/** The trigger's box; a 256 x 160 panel in a 1024px wide viewport. */
function at(y: number, x = 10, width = 230) {
    vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue(
        DOMRect.fromRect({ x, y, width, height: 52 }),
    );
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(160);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(256);
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(
        1024,
    );
}
const key = (target: Element, name: string, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', {
        key: name,
        shiftKey,
        bubbles: true,
        cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
};

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
        expect(menu()!.className).toContain('z-50');
    });

    it('lines the box panel up with the trigger left edge', async () => {
        await mount(false, 'box');
        at(window.innerHeight - 60, 12, 230);
        trigger().click();
        await flush();
        expect(menu()!.style.left).toBe('12px');
        expect(menu()!.style.right).toBe('');
    });

    it('opens the rail panel rightwards from the narrow rail', async () => {
        await mount(false, 'icon');
        at(window.innerHeight - 60, 18, 44);
        trigger().click();
        await flush();
        expect(menu()!.style.left).toBe('18px');
    });

    it('keeps the panel 8px inside the viewport', async () => {
        await mount(false, 'icon');
        at(window.innerHeight - 60, 900, 44);
        trigger().click();
        await flush();
        expect(menu()!.style.left).toBe(`${1024 - 256 - 8}px`);
    });

    it('aligns the app bar panel to the trigger right edge', async () => {
        await mount(false, 'bar');
        at(8, 900, 100);
        trigger().click();
        await flush();
        expect(menu()!.style.left).toBe(`${1000 - 256}px`);
    });

    it('stacks above a drawer teleported after it opened (lg, then shrunk)', async () => {
        await mount(true);
        at(window.innerHeight - 60);
        trigger().click();
        await flush();
        // The drawer root follows the panel's place under <body> or not:
        // its z-index, not DOM order, keeps the panel on top.
        expect(menu()!.className).toContain('z-[60]');
        expect(menu()!.className).not.toContain('z-50');
        expect(menu()!.closest('[inert]')).toBeNull();
    });

    it('Escape in the drawer closes the menu only', async () => {
        await mount(true);
        at(window.innerHeight - 60);
        trigger().click();
        await flush();
        item('Log out').focus();
        key(item('Log out'), 'Escape');
        await flush();
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(trigger());
        expect(drawerClose).not.toHaveBeenCalled();
    });

    it.each([false, true])(
        'Tab (shift %s) from the panel closes it onto the trigger',
        async (shift) => {
            await mount(true);
            at(window.innerHeight - 60);
            trigger().click();
            await flush();
            item('Change password').focus();
            const event = key(item('Change password'), 'Tab', shift);
            await flush();
            expect(event.defaultPrevented).toBe(false);
            expect(trigger().getAttribute('aria-expanded')).toBe('false');
            expect(document.activeElement).toBe(trigger());
        },
    );
});
