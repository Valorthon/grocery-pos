import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { flush } from '@/testing/form-dom';
import PageHeader from './PageHeader.vue';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function mount(
    props: InstanceType<typeof PageHeader>['$props'],
    slots: Record<string, () => unknown> = {},
) {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/:p(.*)*', component: { render: () => null } }],
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({ render: () => h(PageHeader, props, slots) });
    app.use(router);
    app.mount(host);
    await router.isReady();
    await flush();
    return host;
}

describe('PageHeader (#157)', () => {
    it('renders the title as the page h1 in the display font', async () => {
        const host = await mount({ title: 'Products' });
        const h1s = host.querySelectorAll('h1');
        expect(h1s).toHaveLength(1);
        expect(h1s[0].textContent?.trim()).toBe('Products');
        expect(h1s[0].classList).toContain('font-display');
        expect(host.querySelector('nav')).toBeNull();
    });

    it('shows a description, breadcrumbs and actions', async () => {
        const host = await mount(
            {
                title: 'Edit',
                description: 'Change the product.',
                breadcrumbs: [
                    { label: 'Products', to: '/products' },
                    { label: 'Edit' },
                ],
            },
            { actions: () => h('button', 'Save') },
        );
        expect(host.textContent).toContain('Change the product.');
        const nav = host.querySelector('nav[aria-label="Breadcrumb"]')!;
        const link = nav.querySelector('a')!;
        expect(link.getAttribute('href')).toBe('/products');
        expect(link.classList).toContain('focus-ring');
        expect(link.classList).not.toContain('outline-none');
        expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe(
            'Edit',
        );
        expect(host.querySelector('button')?.textContent).toBe('Save');
    });

    it('marks only the last crumb current, even a linked one', async () => {
        const host = await mount({
            title: 'Count #12',
            breadcrumbs: [
                { label: 'Inventory' },
                { label: 'Stock counts', to: '/counts' },
                { label: 'Count #12', to: '/counts/12' },
            ],
        });
        const current = host.querySelectorAll('[aria-current="page"]');
        expect(current).toHaveLength(1);
        expect(current[0].textContent?.trim()).toBe('Count #12');
        expect(current[0].tagName).toBe('SPAN');
        expect(host.querySelectorAll('nav a')).toHaveLength(1);
        for (const el of host.querySelectorAll('nav li > :not(svg)'))
            expect(el.classList).toContain('min-h-6');
    });
});
