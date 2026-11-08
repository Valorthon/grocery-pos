import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, h } from 'vue';
import { flush } from '@/testing/form-dom';
import EmptyState from './EmptyState.vue';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function mount(
    props: InstanceType<typeof EmptyState>['$props'],
    slots: Record<string, () => unknown> = {},
) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({ render: () => h(EmptyState, props, slots) });
    app.mount(host);
    await flush();
    return host;
}

describe('EmptyState (#157)', () => {
    it('shows the title alone without a heading', async () => {
        const host = await mount({ title: 'No products yet' });
        expect(host.textContent?.trim()).toBe('No products yet');
        expect(host.querySelector('h1, h2, h3, [aria-hidden]')).toBeNull();
    });

    it('shows the icon (hidden from AT), hint and action', async () => {
        const host = await mount(
            { title: 'No matches', hint: 'Try another search.' },
            {
                icon: () => h('svg'),
                action: () => h('button', 'Clear filters'),
            },
        );
        expect(host.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
        expect(host.textContent).toContain('Try another search.');
        expect(host.querySelector('button')?.textContent).toBe('Clear filters');
    });
});
