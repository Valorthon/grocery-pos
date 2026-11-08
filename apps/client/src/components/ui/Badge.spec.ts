import { afterEach, describe, expect, it } from 'vitest';
import { type App, type Component, createApp, h } from 'vue';
import { flush } from '@/testing/form-dom';
import Badge from './Badge.vue';

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

describe('Badge colours come from status tokens (#155)', () => {
    it.each([
        ['success', 'bg-success-bg text-success-fg border-success-border'],
        ['error', 'bg-danger-bg text-danger-fg border-danger-border'],
        ['warning', 'bg-warning-bg text-warning-fg border-warning-border'],
        ['info', 'bg-info-bg text-info-fg border-info-border'],
        ['primary', 'bg-leaf-50 text-leaf-700 border-leaf-200'],
        ['neutral', 'bg-paper text-ink border-line'],
    ])('%s', async (color, expected) => {
        const el = await mount(Badge, { color });
        for (const c of expected.split(' ')) expect(el.classList).toContain(c);
        expect(el.className).not.toMatch(RAW_PALETTE);
    });
});
