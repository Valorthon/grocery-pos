import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, h, ref } from 'vue';
import { flush } from '@/testing/form-dom';
import BaseSelect from './BaseSelect.vue';

const USERS = [
    { label: 'ana', value: 'u1' },
    { label: 'ben', value: 'u2' },
];

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function mount(allLabel?: string, initial: string | null = null) {
    const model = ref<string | number | null>(initial);
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({
        render: () =>
            h(BaseSelect, {
                modelValue: model.value,
                options: USERS,
                allLabel,
                'onUpdate:modelValue': (v: string | null) => {
                    model.value = v;
                },
            }),
    });
    app.mount(host);
    await flush();
    const select = host.querySelector('select')!;
    return { model, select };
}

async function choose(select: HTMLSelectElement, value: string) {
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await flush();
}

const shown = (select: HTMLSelectElement) =>
    select.options[select.selectedIndex]?.textContent?.trim();

describe('BaseSelect "All" option (issue #20)', () => {
    it('shows null as "All", not as the first option', async () => {
        const { select } = await mount('All users');

        expect([...select.options].map((o) => o.textContent?.trim())).toEqual([
            'All users',
            'ana',
            'ben',
        ]);
        expect(shown(select)).toBe('All users');
    });

    it('maps a pick to its value and "All" back to null', async () => {
        const { model, select } = await mount('All users');

        await choose(select, 'u2');
        expect(model.value).toBe('u2');
        expect(shown(select)).toBe('ben');

        await choose(select, '');
        expect(model.value).toBeNull();
        expect(shown(select)).toBe('All users');
    });

    it('adds nothing without an allLabel', async () => {
        const { model, select } = await mount(undefined, 'u1');

        expect(select.options).toHaveLength(2);
        await choose(select, 'u2');
        expect(model.value).toBe('u2');
    });
});
