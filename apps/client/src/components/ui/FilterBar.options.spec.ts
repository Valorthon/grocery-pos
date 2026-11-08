import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, h } from 'vue';
import FilterBar from './FilterBar.vue';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

describe('FilterBar options (#171)', () => {
    function mountBar(props: Record<string, unknown>) {
        const host = document.createElement('div');
        document.body.appendChild(host);
        app = createApp({
            render: () => h(FilterBar, props, () => h('select')),
        });
        app.mount(host);
        return host;
    }

    it('has no search box or Search button when not searchable', () => {
        const host = mountBar({ searchable: false });
        expect(host.querySelector('input')).toBeNull();
        expect(
            [...host.querySelectorAll('button')].some(
                (b) => b.textContent?.trim() === 'Search',
            ),
        ).toBe(false);
    });

    it('ties the search hint and id to the box', () => {
        const host = mountBar({ searchId: 'q', searchHint: 'Exact name.' });
        const box = host.querySelector<HTMLInputElement>('#q')!;
        const hint = document.getElementById(
            box.getAttribute('aria-describedby')!,
        );
        expect(hint?.textContent?.trim()).toBe('Exact name.');
    });
});
