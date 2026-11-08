import { afterEach, describe, expect, it } from 'vitest';
import { type App, type Component, createApp, h } from 'vue';
import { flush } from '@/testing/form-dom';
import BaseButton from './BaseButton.vue';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function mount(comp: Component, props: Record<string, unknown>) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({ render: () => h(comp, props, () => 'Go') });
    app.mount(host);
    await flush();
    return host.firstElementChild!;
}

const RAW_PALETTE = /\b(?:slate|red|emerald|amber|sky|primary)-\d/;

describe('BaseButton variants on Fresh market tokens (#155)', () => {
    it.each([
        ['primary', ['bg-leaf-600', 'text-white', 'hover:bg-leaf-700']],
        ['accent', ['bg-citrus-500', 'text-ink', 'hover:bg-citrus-400']],
        ['outline', ['bg-surface', 'text-ink', 'border-line-strong']],
        ['ghost', ['text-ink', 'hover:bg-paper']],
        ['danger', ['text-danger-fg', 'hover:bg-danger-bg']],
        [
            'danger-solid',
            ['bg-danger-solid', 'text-white', 'hover:bg-danger-fg'],
        ],
    ])('%s uses tokens only', async (variant, expected) => {
        const el = await mount(BaseButton, { variant });
        for (const c of expected) expect(el.classList).toContain(c);
        expect(el.className).not.toMatch(RAW_PALETTE);
        expect(el.classList).toContain('rounded-control');
        expect(el.classList).toContain('focus-ring');
        expect(el.className).not.toContain('outline-none');
    });

    it('never gives citrus white text (fails AA)', async () => {
        const el = await mount(BaseButton, { variant: 'accent' });
        expect(el.classList).not.toContain('text-white');
    });

    it('keeps background colours out of the base classes', async () => {
        const el = await mount(BaseButton, { variant: 'ghost' });
        expect([...el.classList].filter((c) => c.startsWith('bg-'))).toEqual(
            [],
        );
    });
});
