import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, h, nextTick, ref } from 'vue';
import BaseCombobox, { type ComboboxOption } from './BaseCombobox.vue';

const MILK: ComboboxOption = {
    value: 'id-milk',
    label: 'BEAR BRAND MILK',
    subtitle: 'EAN: 4800361002516',
    display: '4800361002516',
};

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

/** Mounts `<BaseCombobox v-model="text" v-model:selected="selected" />`. */
function mount(initial: ComboboxOption[] = [MILK]) {
    const options = ref<ComboboxOption[]>(initial);
    const text = ref('');
    const selected = ref<ComboboxOption | null>(null);
    const events: { select: ComboboxOption[]; search: string[] } = {
        select: [],
        search: [],
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({
        render: () =>
            h(BaseCombobox, {
                options: options.value,
                modelValue: text.value,
                'onUpdate:modelValue': (v: string) => (text.value = v),
                selected: selected.value,
                'onUpdate:selected': (v: ComboboxOption | null) =>
                    (selected.value = v),
                onSelect: (v: ComboboxOption) => events.select.push(v),
                onSearch: (v: string) => events.search.push(v),
            }),
    });
    app.mount(host);
    const input = host.querySelector('input')!;
    async function type(value: string) {
        input.value = value;
        input.dispatchEvent(new Event('input'));
        await nextTick();
    }
    /** The parent's answer to the last query: a fresh options array. */
    async function answer(next: ComboboxOption[] = [MILK]) {
        options.value = [...next];
        await nextTick();
    }
    async function enter() {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        await nextTick();
    }
    async function pickFirst() {
        host.querySelector('li')!.dispatchEvent(new Event('mousedown'));
        await nextTick();
    }
    return {
        host,
        input,
        text,
        selected,
        events,
        type,
        answer,
        enter,
        pickFirst,
    };
}

describe('BaseCombobox (#17)', () => {
    it('writes the pick back into the box and emits select', async () => {
        const c = mount();
        await c.type('bear');
        expect(c.events.search).toEqual(['bear']);

        await c.pickFirst();
        expect(c.text.value).toBe('4800361002516');
        expect(c.input.value).toBe('4800361002516');
        expect(c.selected.value).toEqual(MILK);
        expect(c.events.select).toEqual([MILK]);
    });

    it('writes back the label when an option has no display text', async () => {
        const c = mount([{ value: 'x', label: 'COFFEE' }]);
        await c.type('cof');
        await c.pickFirst();
        expect(c.text.value).toBe('COFFEE');
    });

    it('picks the highlighted option with Enter', async () => {
        const c = mount();
        await c.type('bear');
        await c.answer();
        await c.enter();
        expect(c.selected.value).toEqual(MILK);
        expect(c.text.value).toBe('4800361002516');
    });

    it('ignores Enter while the matches are for an older query', async () => {
        const c = mount();
        await c.type('bear');
        await c.answer();
        await c.type('bear brand coffee');
        await c.enter();
        expect(c.selected.value).toBeNull();
        expect(c.events.select).toEqual([]);
        expect(c.text.value).toBe('bear brand coffee');
    });

    it('ignores Enter while the list is closed', async () => {
        const c = mount();
        await c.enter();
        expect(c.selected.value).toBeNull();

        await c.type('bear');
        await c.answer();
        c.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await nextTick();
        await c.enter();
        expect(c.selected.value).toBeNull();
        expect(c.events.select).toEqual([]);
    });

    it('shows which product is picked', async () => {
        const c = mount();
        expect(c.host.querySelector('[data-testid="combobox-selected"]')).toBe(
            null,
        );
        await c.type('bear');
        await c.pickFirst();
        const shown = c.host.querySelector(
            '[data-testid="combobox-selected"]',
        )!;
        expect(shown.textContent).toContain('BEAR BRAND MILK');
        expect(shown.textContent).toContain('4800361002516');
    });

    it('clears the pick when the text is edited afterwards', async () => {
        const c = mount();
        await c.type('bear');
        await c.pickFirst();
        await c.type('480036100251');
        expect(c.selected.value).toBeNull();
        expect(c.text.value).toBe('480036100251');
        expect(c.host.querySelector('[data-testid="combobox-selected"]')).toBe(
            null,
        );
    });
});

describe('BaseCombobox accessibility (#22)', () => {
    const COFFEE: ComboboxOption = { value: 'id-coffee', label: 'COFFEE' };

    it('is a combobox wired to a listbox of options', async () => {
        const c = mount([MILK, COFFEE]);
        expect(c.input.getAttribute('role')).toBe('combobox');
        expect(c.input.getAttribute('aria-expanded')).toBe('false');
        expect(c.input.getAttribute('aria-activedescendant')).toBeNull();

        await c.type('b');
        await c.answer([MILK, COFFEE]);
        const list = c.host.querySelector('[role="listbox"]')!;
        expect(c.input.getAttribute('aria-expanded')).toBe('true');
        expect(c.input.getAttribute('aria-controls')).toBe(list.id);
        const options = [...list.querySelectorAll('[role="option"]')];
        expect(options).toHaveLength(2);
        expect(c.input.getAttribute('aria-activedescendant')).toBe(
            options[0].id,
        );
        expect(options[0].getAttribute('aria-selected')).toBe('true');

        c.input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown' }),
        );
        await nextTick();
        expect(c.input.getAttribute('aria-activedescendant')).toBe(
            options[1].id,
        );
        expect(options[1].getAttribute('aria-selected')).toBe('true');
    });

    it('scrolls the highlighted option into view', async () => {
        const scrolled: string[] = [];
        const original = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (this: Element) {
            scrolled.push(this.textContent?.trim() ?? '');
        };
        try {
            const c = mount([MILK, COFFEE]);
            await c.type('b');
            await c.answer([MILK, COFFEE]);
            c.input.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'ArrowDown' }),
            );
            await nextTick();
            await nextTick();
            expect(scrolled[scrolled.length - 1]).toBe('COFFEE');
        } finally {
            Element.prototype.scrollIntoView = original;
        }
    });

    it('closes the list on blur right away', async () => {
        const c = mount();
        await c.type('bear');
        await c.answer();
        c.input.dispatchEvent(new Event('blur'));
        await nextTick();
        expect(c.host.querySelector('[role="listbox"]')).toBeNull();
    });

    it('keeps Escape to itself only while the list is open', async () => {
        const c = mount();
        const reached: string[] = [];
        const listener = () => reached.push('document');
        document.addEventListener('keydown', listener);
        try {
            await c.type('bear');
            await c.answer();
            const esc = () =>
                c.input.dispatchEvent(
                    new KeyboardEvent('keydown', {
                        key: 'Escape',
                        bubbles: true,
                    }),
                );
            esc();
            await nextTick();
            expect(c.host.querySelector('[role="listbox"]')).toBeNull();
            expect(reached).toEqual([]);

            esc();
            expect(reached).toEqual(['document']);
        } finally {
            document.removeEventListener('keydown', listener);
        }
    });
});
