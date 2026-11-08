import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, h } from 'vue';
import { flush } from '@/testing/form-dom';
import StatTile from './StatTile.vue';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function mount(props: InstanceType<typeof StatTile>['$props']) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({ render: () => h(StatTile, props) });
    app.mount(host);
    await flush();
    return host.firstElementChild!;
}

describe('StatTile (#157)', () => {
    it('shows label, value in the display font and hint', async () => {
        const el = await mount({
            label: 'Low stock',
            value: 12,
            hint: 'At or below reorder level',
        });
        const value = el.querySelector('.font-display')!;
        expect(value.textContent?.trim()).toBe('12');
        expect(value.classList).toContain('num');
        expect(el.textContent).toContain('Low stock');
        expect(el.textContent).toContain('At or below reorder level');
    });

    it.each([
        ['neutral', 'border-line'],
        ['success', 'border-success-border'],
        ['warning', 'border-warning-border'],
        ['danger', 'border-danger-border'],
    ] as const)('%s tone sets one border token', async (tone, border) => {
        const el = await mount({ label: 'x', value: '₱1.00', tone });
        expect(el.classList).toContain(border);
        expect(el.className.match(/\bborder-[a-z]+-?[a-z]*\b/g)).toEqual([
            border,
        ]);
    });
});
