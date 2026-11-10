import { afterEach, describe, expect, it } from 'vitest';
import { type App, type Component, createApp, h } from 'vue';
import { flush } from '@/testing/form-dom';
import StatusBadge from './StatusBadge.vue';
import type { StatusMap } from './status-badge';

let app: App | null = null;
afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

const MAP: StatusMap<'out' | 'ok'> = {
    out: { label: 'Out of stock', color: 'error' },
    ok: { label: 'In stock', color: 'success' },
};

async function mount(props: Record<string, unknown>) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({
        render: () => h(StatusBadge as Component, { map: MAP, ...props }),
    });
    app.mount(host);
    await flush();
    return host.firstElementChild as HTMLElement;
}

describe('StatusBadge (#242)', () => {
    it.each([
        ['out', 'Out of stock', 'bg-danger-bg'],
        ['ok', 'In stock', 'bg-success-bg'],
    ])('maps %s to its label and colour', async (status, label, cls) => {
        const el = await mount({ status, 'data-testid': 'badge' });
        expect(el.textContent).toBe(label);
        expect(el.classList).toContain(cls);
        expect(el.dataset.testid).toBe('badge');
    });
    it('sits under the figure below sm only', async () => {
        const el = await mount({ status: 'ok', placement: 'under' });
        expect(el.className).toBe('mt-1 block sm:hidden');
        expect(el.firstElementChild!.textContent).toBe('In stock');
        expect(el.firstElementChild!.classList).toContain('bg-success-bg');
    });
});
