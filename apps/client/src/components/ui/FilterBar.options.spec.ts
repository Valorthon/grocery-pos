import { afterEach, describe, expect, it } from 'vitest';
import { type App, type VNode, createApp, h } from 'vue';
import FilterBar from './FilterBar.vue';
import SegmentedFilter from './SegmentedFilter.vue';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

describe('FilterBar options (#171)', () => {
    function mountBar(
        props: Record<string, unknown>,
        children: () => VNode[] = () => [h('select')],
    ) {
        const host = document.createElement('div');
        document.body.appendChild(host);
        app = createApp({
            render: () => h(FilterBar, props, children),
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

    it('hides Clear Filters when not clearable (#215)', () => {
        const host = mountBar({ clearable: false });
        expect(host.textContent).not.toContain('Clear Filters');
    });

    it('caps a lone select at 16rem but not chips (#261)', () => {
        const host = mountBar({ searchable: false }, () => [
            h('select'),
            h(SegmentedFilter, {
                modelValue: 'a',
                options: [{ value: 'a', label: 'A' }],
                label: 'Pick',
            }),
        ]);
        const wrapper = host.querySelector('select')!.parentElement!;
        expect(wrapper.classList).toContain('*:max-w-64');
        expect(wrapper.classList).toContain('*:data-segmented:max-w-none');
        expect(
            host.querySelector('select')!.hasAttribute('data-segmented'),
        ).toBe(false);
        expect(
            host.querySelector('[role=group]')!.hasAttribute('data-segmented'),
        ).toBe(true);
    });
});
