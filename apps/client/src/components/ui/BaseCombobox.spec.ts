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
function mount(options: ComboboxOption[] = [MILK]) {
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
                options,
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
    async function pickFirst() {
        host.querySelector('li')!.dispatchEvent(new Event('mousedown'));
        await nextTick();
    }
    return { host, input, text, selected, events, type, pickFirst };
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
        c.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        await nextTick();
        expect(c.selected.value).toEqual(MILK);
        expect(c.text.value).toBe('4800361002516');
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
