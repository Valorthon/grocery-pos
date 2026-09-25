import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h, ref } from 'vue';
import { flush } from '@/testing/form-dom';
import BaseDropdown from './BaseDropdown.vue';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

/** A menu button with a heading and two items (issue #22). */
function mount() {
    const open = ref(false);
    const picked = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({
        render: () =>
            h(
                BaseDropdown,
                {
                    modelValue: open.value,
                    'onUpdate:modelValue': (v: boolean) => (open.value = v),
                },
                {
                    trigger: ({ trigger }: { trigger: object }) =>
                        h('button', { ...trigger, id: 'trigger' }, 'Account'),
                    menu: () => [
                        h('p', { id: 'info' }, 'Signed in as ana'),
                        h(
                            'button',
                            {
                                role: 'menuitem',
                                id: 'profile',
                                onClick: picked,
                            },
                            'Profile',
                        ),
                        h(
                            'button',
                            { role: 'menuitem', id: 'signout' },
                            'Sign out',
                        ),
                    ],
                },
            ),
    });
    app.mount(host);
    return { open, picked };
}

const el = (id: string) => document.getElementById(id)!;
const key = async (target: Element, name: string) => {
    target.dispatchEvent(
        new KeyboardEvent('keydown', {
            key: name,
            bubbles: true,
            cancelable: true,
        }),
    );
    await flush();
};
/** A click from Enter or Space on the focused button (detail 0). */
const keyboardClick = async (target: Element) => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    await flush();
};

describe('BaseDropdown (issue #22)', () => {
    it('is a menu button that says whether it is open', async () => {
        const { open } = mount();
        const trigger = el('trigger');
        expect(trigger.tagName).toBe('BUTTON');
        expect(trigger.getAttribute('type')).toBe('button');
        expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        trigger.dispatchEvent(
            new MouseEvent('click', { bubbles: true, detail: 1 }),
        );
        await flush();
        expect(open.value).toBe(true);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        const menu = document.querySelector('[role="menu"]')!;
        expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
    });

    it('focuses the first item when opened from the keyboard', async () => {
        mount();
        el('trigger').focus();
        await keyboardClick(el('trigger'));
        expect(document.activeElement).toBe(el('profile'));
    });

    it('opens with ↓ or ↑ and moves between the items with the arrows', async () => {
        mount();
        el('trigger').focus();
        await key(el('trigger'), 'ArrowUp');
        expect(document.activeElement).toBe(el('signout'));

        await key(el('signout'), 'ArrowDown');
        expect(document.activeElement).toBe(el('profile'));
        await key(el('profile'), 'ArrowUp');
        expect(document.activeElement).toBe(el('signout'));
        await key(el('signout'), 'Home');
        expect(document.activeElement).toBe(el('profile'));
        await key(el('profile'), 'End');
        expect(document.activeElement).toBe(el('signout'));
    });

    it('closes on Escape, gives the focus back to the trigger, and keeps Escape to itself', async () => {
        const { open } = mount();
        const reached = vi.fn();
        const listener = (e: KeyboardEvent) => {
            if (e.key === 'Escape') reached();
        };
        document.addEventListener('keydown', listener);
        try {
            el('trigger').focus();
            await key(el('trigger'), 'ArrowDown');
            await key(el('profile'), 'Escape');
            expect(open.value).toBe(false);
            expect(document.activeElement).toBe(el('trigger'));
            expect(reached).not.toHaveBeenCalled();
        } finally {
            document.removeEventListener('keydown', listener);
        }
    });

    it('closes on a click on an item, not on the rest of the panel', async () => {
        const { open, picked } = mount();
        el('trigger').click();
        await flush();

        el('info').click();
        await flush();
        expect(open.value).toBe(true);

        el('profile').click();
        await flush();
        expect(picked).toHaveBeenCalled();
        expect(open.value).toBe(false);
    });

    it('closes when the focus tabs out of it', async () => {
        const { open } = mount();
        const after = document.createElement('button');
        document.body.appendChild(after);
        el('trigger').focus();
        await keyboardClick(el('trigger'));

        el('profile').dispatchEvent(
            new FocusEvent('focusout', { bubbles: true, relatedTarget: after }),
        );
        await flush();
        expect(open.value).toBe(false);
    });
});
