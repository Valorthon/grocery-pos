import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, h, ref } from 'vue';
import { flush } from '@/testing/form-dom';
import { useAppliedFilters, useListPaging } from '@/composables/useListFetch';
import FilterBar from './FilterBar.vue';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

/** A page wiring FilterBar to the real list composables. */
function harness() {
    const load = vi.fn();
    const name = ref('');
    const category = ref<string | null>(null);
    let pageRef: ReturnType<typeof useListPaging>['page'] | null = null;
    const Page = defineComponent({
        setup() {
            const { page, search } = useListPaging(load);
            pageRef = page;
            const { applied, apply } = useAppliedFilters(
                () => ({ name: name.value, category: category.value }),
                search,
            );
            function clear() {
                name.value = '';
                category.value = null;
                apply();
            }
            return () =>
                h(
                    FilterBar,
                    {
                        search: name.value,
                        'onUpdate:search': (v: string) => (name.value = v),
                        searchLabel: 'Search name',
                        active: !!(
                            name.value ||
                            category.value ||
                            applied.value.name ||
                            applied.value.category
                        ),
                        onSearch: apply,
                        onClear: clear,
                    },
                    () =>
                        h('select', {
                            'aria-label': 'Category',
                            onChange: (e: Event) => {
                                category.value =
                                    (e.target as HTMLSelectElement).value ||
                                    null;
                                apply();
                            },
                            innerHTML:
                                '<option value=""></option><option value="dairy">Dairy</option>',
                        }),
                );
        },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(Page);
    app.mount(host);
    return { host, load, page: () => pageRef! };
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
    const b = [...host.querySelectorAll('button')].find((x) =>
        x.textContent?.trim().startsWith(text),
    );
    if (!b) throw new Error(`No button ${text}`);
    return b;
}

async function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await flush();
}

/** Enter in the search box: the browser submits the form once. */
async function pressEnter(host: HTMLElement) {
    host.querySelector('form')!.requestSubmit();
    await flush();
}

describe('FilterBar (#157, #215)', () => {
    it('is a search landmark form', () => {
        const { host } = harness();
        expect(host.querySelector('form[role="search"]')).not.toBeNull();
        expect(button(host, 'Search').type).toBe('submit');
    });

    it('shows every filter inline: no Filters toggle, panel or chips', async () => {
        const { host } = harness();
        await flush();
        expect(host.querySelector('[aria-expanded]')).toBeNull();
        expect(host.querySelector('[data-chip]')).toBeNull();
        expect(host.querySelector('[aria-label="Applied filters"]')).toBeNull();
        expect(host.textContent).not.toContain('Clear all');
        expect(
            [...host.querySelectorAll('button')].some(
                (b) => b.textContent?.trim() === 'Filters',
            ),
        ).toBe(false);
        // Search box, Search, the filter, then Clear Filters last in one row.
        const row = host.querySelector('form > div')!;
        expect(row.classList).toContain('flex-wrap');
        const controls = [
            ...row.querySelectorAll('input, select, button'),
        ].filter((el) => el.getAttribute('aria-label') !== 'Clear');
        expect(
            controls.map((el) => el.textContent?.trim() || el.tagName),
        ).toEqual(['INPUT', 'Search', 'Dairy', 'Clear Filters']);
        const clear = button(host, 'Clear Filters');
        expect(clear.classList).toContain('ml-auto');
        expect(clear.classList).toContain('min-h-11');
    });

    it('Clear Filters is disabled at the defaults and enabled once a filter is entered or applied', async () => {
        const { host, load } = harness();
        await flush();
        expect(button(host, 'Clear Filters').disabled).toBe(true);

        await type(host.querySelector('input')!, 'milk');
        expect(button(host, 'Clear Filters').disabled).toBe(false);
        await pressEnter(host);
        expect(load).toHaveBeenCalledTimes(1);

        button(host, 'Clear Filters').click();
        await flush();
        expect(load).toHaveBeenCalledTimes(2);
        expect(host.querySelector('input')!.value).toBe('');
        expect(button(host, 'Clear Filters').disabled).toBe(true);

        const select = host.querySelector('select')!;
        select.value = 'dairy';
        select.dispatchEvent(new Event('change'));
        await flush();
        expect(button(host, 'Clear Filters').disabled).toBe(false);
    });

    it('the Search button and the clear (x) each search once', async () => {
        const { host, load } = harness();
        await flush();
        await type(host.querySelector('input')!, 'egg');
        button(host, 'Search').click();
        await flush();
        expect(load).toHaveBeenCalledTimes(1);

        const clear = host.querySelector<HTMLButtonElement>(
            'button[aria-label="Clear"]',
        )!;
        expect(clear.classList).toContain('min-h-11');
        expect(clear.classList).toContain('min-w-11');
        clear.click();
        await flush();
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('Clear from page 2 goes to page 1 with one load', async () => {
        const { host, load, page } = harness();
        await type(host.querySelector('input')!, 'egg');
        await pressEnter(host);
        page().value = 2;
        await flush();
        load.mockClear();
        button(host, 'Clear Filters').click();
        await flush();
        expect(page().value).toBe(1);
        expect(load).toHaveBeenCalledTimes(1);
    });
});
