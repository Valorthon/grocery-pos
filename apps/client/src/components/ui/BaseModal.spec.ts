import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, h, ref, type VNodeChild } from 'vue';
import { flush } from '@/testing/form-dom';
import BaseModal from './BaseModal.vue';

let app: App | null = null;

/** Mounts `render` as the app, in a host appended to <body>. */
function mountApp(render: () => VNodeChild): HTMLElement {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({ render });
    app.mount(host);
    return host;
}

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

/** Two modals, the second opened over the first (issue #19). */
async function mountStacked() {
    const lower = ref(false);
    const upper = ref(false);
    mountApp(() => [
        h(BaseModal, {
            modelValue: lower.value,
            'onUpdate:modelValue': (v: boolean) => (lower.value = v),
            title: 'Lower',
        }),
        h(BaseModal, {
            modelValue: upper.value,
            'onUpdate:modelValue': (v: boolean) => (upper.value = v),
            title: 'Upper',
        }),
    ]);
    lower.value = true;
    await flush();
    upper.value = true;
    await flush();
    return { lower, upper };
}

const escape = async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
};

describe('stacked BaseModals (issue #19)', () => {
    it('lets Escape close only the topmost one', async () => {
        const { lower, upper } = await mountStacked();

        await escape();
        expect(upper.value).toBe(false);
        expect(lower.value).toBe(true);

        await escape();
        expect(lower.value).toBe(false);
    });

    it('keeps the page locked until the last one closes', async () => {
        const { lower, upper } = await mountStacked();
        expect(document.body.style.overflow).toBe('hidden');

        upper.value = false;
        await flush();
        expect(document.body.style.overflow).toBe('hidden');

        lower.value = false;
        await flush();
        expect(document.body.style.overflow).toBe('');
    });

    it('unlocks when the page goes away with modals open', async () => {
        await mountStacked();
        app!.unmount();
        app = null;
        expect(document.body.style.overflow).toBe('');
    });
});

/**
 * One modal with a title, subtitle, two inputs and a footer button, opened
 * from a trigger button in the app root (issue #22).
 */
async function mountOne(
    props: Record<string, unknown> = {},
    body: () => ReturnType<typeof h>[] = () => [
        h('input', { 'data-testid': 'first' }),
        h('input', { 'data-testid': 'second' }),
    ],
) {
    const open = ref(false);
    const host = mountApp(() => [
        h('button', { 'data-testid': 'trigger' }, 'Open'),
        h(
            BaseModal,
            {
                modelValue: open.value,
                'onUpdate:modelValue': (v: boolean) => (open.value = v),
                title: 'Edit item',
                subtitle: 'Change the details',
                ...props,
            },
            {
                default: body,
                footer: () => [h('button', { 'data-testid': 'save' }, 'Save')],
            },
        ),
    ]);
    host.id = 'app';
    const trigger = byTestId('trigger');
    trigger.focus();
    open.value = true;
    await flush();
    return { open, host, trigger };
}

const byTestId = (id: string) =>
    document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const dialogs = () => [
    ...document.body.querySelectorAll<HTMLElement>('[role="dialog"]'),
];
const tab = async (shiftKey = false) => {
    const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
    });
    (document.activeElement ?? document.body).dispatchEvent(event);
    await flush();
    return event;
};

describe('BaseModal close button (#89)', () => {
    it('is a 44px target, pulled into the header so it stays as tall', async () => {
        await mountOne();
        const close =
            document.body.querySelector<HTMLElement>('[data-modal-close]')!;
        const classes = close.className.split(/\s+/);

        expect(classes).toEqual(expect.arrayContaining(['w-11', 'h-11']));
        expect(classes).not.toContain('w-8');
        expect(classes).not.toContain('h-8');
        // Negative margins: the header keeps its height and edge.
        expect(classes).toEqual(expect.arrayContaining(['-my-2', '-mr-2']));
    });
});

describe('BaseModal dialog semantics (issue #22)', () => {
    it('is a modal dialog labelled by its title and described by its subtitle', async () => {
        await mountOne();
        const [dialog] = dialogs();
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        const title = document.getElementById(
            dialog.getAttribute('aria-labelledby')!,
        );
        expect(title?.textContent?.trim()).toBe('Edit item');
        const subtitle = document.getElementById(
            dialog.getAttribute('aria-describedby')!,
        );
        expect(subtitle?.textContent?.trim()).toBe('Change the details');
        expect(
            document.body
                .querySelector('[data-modal-close]')
                ?.getAttribute('aria-label'),
        ).toBe('Close');
    });

    it('is labelled by a custom header, or by ariaLabel without one', async () => {
        const open = ref(true);
        mountApp(() => [
            h(
                BaseModal,
                { modelValue: open.value },
                { header: () => h('span', 'Transaction Complete') },
            ),
            h(BaseModal, {
                modelValue: open.value,
                ariaLabel: 'Unnamed',
                closable: false,
            }),
        ]);
        await flush();
        const [withHeader, bare] = dialogs();
        expect(
            document
                .getElementById(withHeader.getAttribute('aria-labelledby')!)
                ?.textContent?.trim(),
        ).toBe('Transaction Complete');
        expect(bare.getAttribute('aria-labelledby')).toBeNull();
        expect(bare.getAttribute('aria-label')).toBe('Unnamed');
    });

    it('focuses the first field, skipping the close button', async () => {
        await mountOne();
        expect(document.activeElement).toBe(byTestId('first'));
    });

    it('focuses an element marked data-autofocus first', async () => {
        await mountOne({}, () => [
            h('input', { 'data-testid': 'first' }),
            h('input', { 'data-testid': 'second', 'data-autofocus': '' }),
        ]);
        expect(document.activeElement).toBe(byTestId('second'));
    });

    it('falls back to the footer when the body has nothing to focus', async () => {
        await mountOne({ closable: false }, () => [h('p', 'Just text')]);
        expect(document.activeElement).toBe(byTestId('save'));
    });

    it('wraps Tab and Shift+Tab inside the dialog', async () => {
        await mountOne();
        byTestId('save').focus();
        const forward = await tab();
        expect(forward.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(
            document.body.querySelector('[data-modal-close]'),
        );

        const back = await tab(true);
        expect(back.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(byTestId('save'));

        // In the middle, the browser moves the focus as usual.
        byTestId('first').focus();
        expect((await tab()).defaultPrevented).toBe(false);
    });

    it('brings a focus that escapes back inside', async () => {
        const { trigger } = await mountOne();
        trigger.focus();
        await flush();
        expect(dialogs()[0].contains(document.activeElement)).toBe(true);
    });

    it('makes the rest of the page inert while open, and restores it', async () => {
        const { open, host } = await mountOne();
        const outside = document.createElement('div');
        outside.setAttribute('inert', '');
        document.body.appendChild(outside);
        const exempt = document.createElement('div');
        exempt.setAttribute('data-inert-exempt', '');
        document.body.appendChild(exempt);
        open.value = false;
        await flush();
        open.value = true;
        await flush();

        expect(host.hasAttribute('inert')).toBe(true);
        expect(host.getAttribute('aria-hidden')).toBe('true');
        expect(exempt.hasAttribute('inert')).toBe(false);
        expect(dialogs()[0].closest('[inert]')).toBeNull();

        open.value = false;
        await flush();
        expect(host.hasAttribute('inert')).toBe(false);
        expect(host.hasAttribute('aria-hidden')).toBe(false);
        // Inert before the modal opened: left as it was.
        expect(outside.hasAttribute('inert')).toBe(true);
    });

    it.each([
        ['Escape', escape],
        [
            'the backdrop',
            async () => {
                document.body
                    .querySelector('.fixed.inset-0')!
                    .dispatchEvent(new MouseEvent('mousedown'));
                await flush();
            },
        ],
        [
            'the close button',
            async () => {
                document.body
                    .querySelector<HTMLElement>('[data-modal-close]')!
                    .click();
                await flush();
            },
        ],
    ])(
        'gives the focus back to the opener when closed by %s',
        async (_, how) => {
            const { open, trigger } = await mountOne();
            expect(document.activeElement).not.toBe(trigger);
            await how();
            expect(open.value).toBe(false);
            expect(document.activeElement).toBe(trigger);
        },
    );

    it('falls back to <main>, not <body>, when the opener is gone', async () => {
        const main = document.createElement('main');
        main.append(document.createElement('button'));
        document.body.prepend(main);
        const { open, trigger } = await mountOne();
        // e.g. a menu item that unmounted while its confirmation was open.
        trigger.remove();

        open.value = false;
        await flush();
        expect(document.activeElement).toBe(main);
        expect(main.getAttribute('tabindex')).toBe('-1');
    });

    it('falls back to the first focusable element without a <main>', async () => {
        const { open, trigger, host } = await mountOne();
        const other = document.createElement('button');
        host.append(other);
        (trigger as HTMLButtonElement).disabled = true;

        open.value = false;
        await flush();
        expect(document.activeElement).toBe(other);
    });

    it('ignores Escape and the backdrop while not closable', async () => {
        const { open } = await mountOne({ closable: false });
        await escape();
        document.body
            .querySelector('.fixed.inset-0')!
            .dispatchEvent(new MouseEvent('mousedown'));
        await flush();
        expect(open.value).toBe(true);
        expect(document.body.querySelector('[data-modal-close]')).toBeNull();
    });

    it('leaves Escape to a child that handled it', async () => {
        const { open } = await mountOne({}, () => [
            h('input', {
                'data-testid': 'first',
                onKeydown: (e: KeyboardEvent) => e.stopPropagation(),
            }),
        ]);
        byTestId('first').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await flush();
        expect(open.value).toBe(true);
    });
});

describe('stacked BaseModals and focus (issue #22)', () => {
    it('traps the focus in the top one and makes the lower one inert', async () => {
        await mountStacked();
        const [lower, upper] = dialogs();
        expect(upper.contains(document.activeElement)).toBe(true);
        expect(lower.closest('[inert]')).not.toBeNull();
        expect(upper.closest('[inert]')).toBeNull();

        await tab();
        expect(upper.contains(document.activeElement)).toBe(true);
    });

    it('gives the focus back into the lower one when the top one closes', async () => {
        const { upper } = await mountStacked();
        const lowerClose =
            document.body.querySelector<HTMLElement>('[data-modal-close]')!;
        expect(document.activeElement).not.toBe(lowerClose);
        upper.value = false;
        await flush();
        // The lower one's close button was focused when the upper opened.
        expect(document.activeElement).toBe(lowerClose);
        expect(lowerClose.closest('[inert]')).toBeNull();
    });

    it('hands its opener to the modal above when a lower one closes first', async () => {
        const trigger = document.createElement('button');
        document.body.appendChild(trigger);
        trigger.focus();
        const { lower, upper } = await mountStacked();

        lower.value = false;
        await flush();
        upper.value = false;
        await flush();
        expect(document.activeElement).toBe(trigger);
    });
});
