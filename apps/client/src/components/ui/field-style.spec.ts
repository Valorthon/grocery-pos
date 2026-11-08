import { afterEach, describe, expect, it } from 'vitest';
import { type App, type Component, createApp, h } from 'vue';
import { flush } from '@/testing/form-dom';
import BaseCheckbox from './BaseCheckbox.vue';
import BaseCombobox from './BaseCombobox.vue';
import BaseInput from './BaseInput.vue';
import BaseSelect from './BaseSelect.vue';
import {
    CHECKBOX_INPUT,
    FIELD_BASE,
    FIELD_DISABLED,
    FIELD_ERROR,
    FIELD_ERROR_TEXT,
    FIELD_LABEL,
    FIELD_OK,
} from './field-style';
import * as styles from './field-style';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function mount(comp: Component, props: Record<string, unknown>) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({ render: () => h(comp, props) });
    app.mount(host);
    await flush();
    return host;
}

const classes = (s: string) => s.split(/\s+/).filter(Boolean);

function expectClasses(el: Element, list: string) {
    for (const c of classes(list)) expect(el.classList).toContain(c);
}

const FIELDS: [string, Component, Record<string, unknown>][] = [
    ['BaseInput', BaseInput, {}],
    ['BaseSelect', BaseSelect, { options: [{ label: 'a', value: 'a' }] }],
    ['BaseCombobox', BaseCombobox, { options: [] }],
];

describe('shared field style (#154)', () => {
    it.each(FIELDS)(
        '%s uses the token field style, leaf focus ring and a sentence-case label tied to the control',
        async (_name, comp, extra) => {
            const host = await mount(comp, { label: 'Product name', ...extra });
            const control = host.querySelector('input, select')!;
            expectClasses(control, FIELD_BASE);
            expectClasses(control, FIELD_OK);
            expect(control.classList).toContain('focus-ring');
            expect(control.classList).toContain('rounded-control');
            expect(control.className).not.toMatch(/slate|rounded-xl/);

            const label = host.querySelector('label')!;
            expect(control.id).not.toBe('');
            expect(label.getAttribute('for')).toBe(control.id);
            expect(control.classList).toContain('bg-surface');
            expect(control.hasAttribute('aria-invalid')).toBe(false);
            expectClasses(label, FIELD_LABEL);
            expect(label.classList).not.toContain('uppercase');
            expect(label.textContent?.trim()).toBe('Product name');
        },
    );

    it.each(FIELDS.filter(([n]) => n !== 'BaseSelect'))(
        '%s shows an error on danger tokens, at least text-xs',
        async (_name, comp, extra) => {
            const host = await mount(comp, { error: 'Required', ...extra });
            const control = host.querySelector('input')!;
            expectClasses(control, FIELD_ERROR);
            expect(control.classList).not.toContain('border-line-strong');
            // bg-surface would beat bg-danger-bg in the built CSS.
            expect(control.classList).not.toContain('bg-surface');
            expect(control.getAttribute('aria-invalid')).toBe('true');
            const msg = [...host.querySelectorAll('p')].find(
                (p) => p.textContent?.trim() === 'Required',
            )!;
            expectClasses(msg, FIELD_ERROR_TEXT);
            expect(msg.id).not.toBe('');
            expect(control.getAttribute('aria-describedby')).toBe(msg.id);
            expect(msg.classList).toContain('text-xs');
        },
    );

    it('no field style turns off the outline that focus-ring draws', () => {
        // .focus\:outline-none comes after .focus-ring in the built CSS
        // and would hide the ring on keyboard focus.
        for (const [name, value] of Object.entries(styles)) {
            if (classes(value).includes('focus-ring'))
                expect(value, name).not.toMatch(/outline-none/);
        }
    });

    it.each(FIELDS)(
        '%s looks disabled when disabled',
        async (_name, comp, extra) => {
            const host = await mount(comp, { disabled: true, ...extra });
            const control = host.querySelector('input, select')!;
            expectClasses(control, FIELD_DISABLED);
            expect(control.classList).not.toContain('cursor-pointer');
        },
    );

    it('BaseCheckbox uses the leaf accent and focus ring', async () => {
        const host = await mount(BaseCheckbox, { label: 'Active' });
        const box = host.querySelector('input[type=checkbox]')!;
        expectClasses(box, CHECKBOX_INPUT);
        expect(box.classList).toContain('focus-ring');
        expect(box.className).not.toMatch(/slate/);
        expect(host.querySelector('label')?.textContent?.trim()).toBe('Active');
    });
});
