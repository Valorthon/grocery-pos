import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
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
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/:p(.*)*', component: { render: () => null } }],
    });
    app = createApp({ render: () => h(StatTile, props) });
    app.use(router);
    app.mount(host);
    await router.isReady();
    await flush();
    return host.firstElementChild!;
}

describe('StatTile (#157)', () => {
    it('shows label, value in the display font and hint', async () => {
        const el = await mount({
            label: 'Low stock',
            value: 12,
            hint: 'At or below low stock level',
        });
        const value = el.querySelector('.font-display')!;
        expect(value.textContent?.trim()).toBe('12');
        expect(value.classList).toContain('num');
        expect(el.textContent).toContain('Low stock');
        expect(el.textContent).toContain('At or below low stock level');
    });

    it.each([
        ['success', 'bg-success-fg', 'good'],
        ['warning', 'bg-warning-fg', 'warning'],
        ['danger', 'bg-danger-fg', 'needs attention'],
    ] as const)(
        '%s tone is a *-fg stripe plus sr-only text',
        async (tone, stripe, word) => {
            const el = await mount({ label: 'Stock', value: '3', tone });
            const bar = el.querySelector('[data-tone-stripe]')!;
            expect(bar.classList).toContain(stripe);
            expect(bar.getAttribute('aria-hidden')).toBe('true');
            expect(el.querySelector('.sr-only')?.textContent).toBe(`, ${word}`);
        },
    );

    it('neutral has no stripe or tone text; toneLabel overrides', async () => {
        app?.unmount();
        const plain = await mount({ label: 'x', value: 1 });
        expect(plain.querySelector('[data-tone-stripe]')).toBeNull();
        expect(plain.querySelector('.sr-only')).toBeNull();
        app?.unmount();
        const el = await mount({
            label: 'x',
            value: 1,
            tone: 'danger',
            toneLabel: 'out of stock',
        });
        expect(el.querySelector('.sr-only')?.textContent).toBe(
            ', out of stock',
        );
    });

    it('loading shows a skeleton instead of the value', async () => {
        const el = await mount({ label: 'Sales', loading: true });
        expect(el.getAttribute('aria-busy')).toBe('true');
        expect(el.querySelector('[data-skeleton]')?.textContent).toContain(
            'Loading',
        );
        expect(el.querySelector('.font-display')).toBeNull();
    });

    it('to renders the tile as a focusable link', async () => {
        const el = await mount({ label: 'Low stock', value: 4, to: '/low' });
        expect(el.tagName).toBe('A');
        expect(el.getAttribute('href')).toBe('/low');
        expect(el.classList).toContain('focus-ring');
    });

    it('a linked tile shows a View cue and a hover border; a plain one none (#193)', async () => {
        const link = await mount({ label: 'Low stock', value: 4, to: '/low' });
        const cue = link.querySelector('[data-tile-link]');
        expect(cue?.textContent).toBe('View');
        expect(cue?.querySelector('svg')).not.toBeNull();
        expect(link.classList).toContain('hover:border-leaf-600');
        app?.unmount();
        const plain = await mount({ label: 'Sales', value: 4 });
        expect(plain.querySelector('[data-tile-link]')).toBeNull();
    });
    it('adds an About note after the label without a taller row (#271)', async () => {
        const el = await mount({
            label: 'Low stock at',
            value: 5,
            help: 'Note text.',
        });
        const button = el.querySelector<HTMLButtonElement>(
            '[data-info-tooltip]',
        )!;
        expect(button.getAttribute('aria-label')).toBe('About low stock at');
        expect(button.parentElement!.classList).toContain('-my-3');
        expect(
            document
                .getElementById(button.getAttribute('aria-describedby')!)!
                .textContent?.trim(),
        ).toBe('Note text.');
    });
    it('has no note without help', async () => {
        const el = await mount({ label: 'EAN', value: '1' });
        expect(el.querySelector('[data-info-tooltip]')).toBeNull();
    });
});
