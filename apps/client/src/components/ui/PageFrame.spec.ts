import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { flush } from '@/testing/form-dom';
import PageFrame from './PageFrame.vue';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function mount(
    path: string,
    props: InstanceType<typeof PageFrame>['$props'] = {},
    slots: Record<string, () => unknown> = {},
) {
    const page = { render: () => h(PageFrame, props, slots) };
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            {
                path: '/inv',
                component: page,
                meta: {
                    title: 'Inventory',
                    description: 'All stock',
                    queryTitle: {
                        key: 'lowStock',
                        value: 'true',
                        title: 'Low stock',
                        description: 'Below low stock level',
                    },
                },
            },
            { path: '/none', component: page },
        ],
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({ render: () => h(RouterView) });
    app.use(router);
    await router.push(path);
    app.mount(host);
    await router.isReady();
    await flush();
    return { host, router };
}

describe('PageFrame (#159)', () => {
    it('shows the route title as the one h1, in a wide column', async () => {
        const { host } = await mount('/inv');
        const h1s = host.querySelectorAll('h1');
        expect(h1s).toHaveLength(1);
        expect(h1s[0].textContent?.trim()).toBe('Inventory');
        const frame = host.querySelector('[data-testid="page-frame"]')!;
        expect(frame.classList).toContain('max-w-7xl');
        expect(frame.classList).not.toContain('max-w-3xl');
    });

    it('follows the query title, as the tab does', async () => {
        const { host, router } = await mount('/inv?lowStock=true');
        expect(host.querySelector('h1')?.textContent?.trim()).toBe('Low stock');
        await router.push('/inv');
        await flush();
        expect(host.querySelector('h1')?.textContent?.trim()).toBe('Inventory');
    });

    it('takes a title override, a narrow column, actions and chips', async () => {
        const { host } = await mount(
            '/none',
            { title: 'Store settings', narrow: true },
            {
                actions: () => h('button', 'Save'),
                chips: () => h('span', { 'data-testid': 'chip' }, 'Filtered'),
                default: () => h('p', 'body'),
            },
        );
        expect(host.querySelector('h1')?.textContent?.trim()).toBe(
            'Store settings',
        );
        const frame = host.querySelector('[data-testid="page-frame"]')!;
        expect(frame.classList).toContain('max-w-3xl');
        expect(host.querySelector('header button')?.textContent).toBe('Save');
        expect(host.querySelector('[data-testid="chip"]')).not.toBeNull();
        expect(host.textContent).toContain('body');
    });

    it('shows the route summary, its query variant, and lets the prop win (#262)', async () => {
        const { host, router } = await mount('/inv');
        const text = () => host.querySelector('header p')?.textContent?.trim();
        expect(text()).toBe('All stock');
        await router.push('/inv?lowStock=true');
        await flush();
        expect(text()).toBe('Below low stock level');
        app?.unmount();
        document.body.innerHTML = '';
        const other = await mount('/inv', { description: 'Welcome back' });
        expect(other.host.querySelector('header p')?.textContent?.trim()).toBe(
            'Welcome back',
        );
    });

    it('shows no summary when the route has none', async () => {
        const { host } = await mount('/none');
        expect(host.querySelector('header p')).toBeNull();
    });
});
