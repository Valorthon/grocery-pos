import { afterEach, describe, expect, it } from 'vitest';
import { type App, type Component, createApp, h } from 'vue';
import { flush } from '@/testing/form-dom';
import ProductCell from './ProductCell.vue';

let app: App | null = null;
afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function mount(props: Record<string, unknown>) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({ render: () => h(ProductCell as Component, props) });
    app.mount(host);
    await flush();
    return host;
}

describe('ProductCell (#242)', () => {
    it('shows the name as typed and the EAN muted below', async () => {
        const host = await mount({ name: 'Fresh milk', ean: '4006381333931' });
        const [name, ean] = [...host.children] as HTMLElement[];
        expect(name.textContent).toBe('Fresh milk');
        expect(ean.textContent).toBe('4006381333931');
        expect(ean.dataset.testid).toBe('row-ean');
        for (const c of ['block', 'text-xs', 'text-muted', 'num'])
            expect(ean.classList).toContain(c);
    });
    it('shows no EAN line without one', async () => {
        const host = await mount({ name: 'Loose rice' });
        expect(host.querySelector('[data-testid=row-ean]')).toBeNull();
    });
});
