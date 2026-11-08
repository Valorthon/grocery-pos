import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, h, ref } from 'vue';
import { flush } from '@/testing/form-dom';
import { useAppliedFilters, useListPaging } from '@/composables/useListFetch';
import FilterBar from './FilterBar.vue';
import type { FilterChip } from './page-primitives';

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
    const category = ref<string | null>('dairy');
    const unit = ref<string | null>('kg');
    let pageRef: ReturnType<typeof useListPaging>['page'] | null = null;
    const Page = defineComponent({
        setup() {
            const { page, search } = useListPaging(load);
            pageRef = page;
            const { applied, apply } = useAppliedFilters(
                () => ({
                    name: name.value,
                    category: category.value,
                    unit: unit.value,
                }),
                search,
            );
            const chips = (): FilterChip[] => {
                const out: FilterChip[] = [];
                const a = applied.value;
                if (a.name) out.push({ key: 'name', label: `Name: ${a.name}` });
                if (a.category)
                    out.push({
                        key: 'category',
                        label: `Category: ${a.category}`,
                        inPanel: true,
                    });
                if (a.unit)
                    out.push({
                        key: 'unit',
                        label: `Unit: ${a.unit}`,
                        inPanel: true,
                    });
                return out;
            };
            function remove(key: string) {
                if (key === 'name') name.value = '';
                else if (key === 'category') category.value = null;
                else unit.value = null;
                apply();
            }
            function clear() {
                name.value = '';
                category.value = null;
                unit.value = null;
                apply();
            }
            return () =>
                h(
                    FilterBar,
                    {
                        search: name.value,
                        'onUpdate:search': (v: string) => (name.value = v),
                        searchLabel: 'Search name',
                        chips: chips(),
                        onSearch: apply,
                        onRemove: remove,
                        onClear: clear,
                    },
                    () => h('select', { 'aria-label': 'Category' }),
                );
        },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(Page);
    app.mount(host);
    return { host, load, page: () => pageRef! };
}

function chipLabels(host: HTMLElement): string[] {
    return [...host.querySelectorAll<HTMLButtonElement>('[data-chip]')].map(
        (b) => b.textContent!.trim(),
    );
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
    const b = [...host.querySelectorAll('button')].find((x) =>
        x.textContent?.trim().startsWith(text),
    );
    if (!b) throw new Error(`No button ${text}`);
    return b;
}

function chip(host: HTMLElement, label: string): HTMLButtonElement {
    return host.querySelector<HTMLButtonElement>(
        `button[aria-label="Remove filter ${label}"]`,
    )!;
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

describe('FilterBar (#157)', () => {
    it('is a search landmark form', () => {
        const { host } = harness();
        expect(host.querySelector('form[role="search"]')).not.toBeNull();
        expect(button(host, 'Search').type).toBe('submit');
    });

    it('chips show applied filters, never typed-but-unsearched text', async () => {
        const { host, load } = harness();
        await flush();
        expect(chipLabels(host)).toEqual(['Category: dairy', 'Unit: kg']);

        await type(host.querySelector('input')!, 'milk');
        expect(chipLabels(host)).toEqual(['Category: dairy', 'Unit: kg']);
        expect(load).not.toHaveBeenCalled();

        await pressEnter(host);
        expect(chipLabels(host)).toEqual([
            'Name: milk',
            'Category: dairy',
            'Unit: kg',
        ]);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('the Search button and the clear (x) each search once', async () => {
        const { host, load } = harness();
        await flush();
        await type(host.querySelector('input')!, 'egg');
        button(host, 'Search').click();
        await flush();
        expect(load).toHaveBeenCalledTimes(1);
        expect(chipLabels(host)[0]).toBe('Name: egg');

        const clear = host.querySelector<HTMLButtonElement>(
            'button[aria-label="Clear"]',
        )!;
        expect(clear.classList).toContain('min-h-11');
        expect(clear.classList).toContain('min-w-11');
        clear.click();
        await flush();
        expect(load).toHaveBeenCalledTimes(2);
        expect(chipLabels(host)).toEqual(['Category: dairy', 'Unit: kg']);
    });

    it('removing a chip runs one search() and focuses the next chip', async () => {
        const { host, load } = harness();
        await flush();
        const c = chip(host, 'Category: dairy');
        c.focus();
        c.click();
        await flush();
        expect(load).toHaveBeenCalledTimes(1);
        expect(chipLabels(host)).toEqual(['Unit: kg']);
        expect(document.activeElement).toBe(chip(host, 'Unit: kg'));
    });

    it('removing a chip from page 2 goes to page 1 with one load', async () => {
        const { host, load, page } = harness();
        await flush();
        page().value = 2;
        await flush();
        load.mockClear();
        chip(host, 'Unit: kg').click();
        await flush();
        expect(page().value).toBe(1);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('removing the last chip focuses the previous one, then the search box', async () => {
        const { host } = harness();
        await flush();
        chip(host, 'Unit: kg').click();
        await flush();
        expect(document.activeElement).toBe(chip(host, 'Category: dairy'));
        chip(host, 'Category: dairy').click();
        await flush();
        expect(host.querySelector('ul')).toBeNull();
        expect(document.activeElement).toBe(host.querySelector('input'));
    });

    it('Clear all resets every chip with one search() and focuses the search box', async () => {
        const { host, load } = harness();
        await flush();
        load.mockClear();
        button(host, 'Clear all').click();
        await flush();
        expect(load).toHaveBeenCalledTimes(1);
        expect(chipLabels(host)).toEqual([]);
        expect(document.activeElement).toBe(host.querySelector('input'));
    });

    it('the Filters badge counts only panel chips', async () => {
        const { host } = harness();
        await flush();
        await type(host.querySelector('input')!, 'tea');
        await pressEnter(host);
        expect(chipLabels(host)).toHaveLength(3);
        expect(button(host, 'Filters').textContent).toContain('2 active');
    });

    it('the Filters disclosure is a native button with aria-expanded', async () => {
        const { host } = harness();
        await flush();
        const toggle = button(host, 'Filters');
        // A native <button type=button>: Enter and Space activate it.
        expect(toggle.tagName).toBe('BUTTON');
        expect(toggle.type).toBe('button');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        const panel = document.getElementById(
            toggle.getAttribute('aria-controls')!,
        )!;
        expect(panel.style.display).toBe('none');
        expect(panel.querySelector('select')).not.toBeNull();

        toggle.focus();
        toggle.click();
        await flush();
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(panel.style.display).toBe('');
        expect(toggle.classList).toContain('focus-ring');
        expect(toggle.classList).toContain('min-h-11');
    });

    it('chip buttons are 44px targets with the focus ring', async () => {
        const { host } = harness();
        await flush();
        const c = host.querySelector<HTMLButtonElement>('[data-chip]')!;
        expect(c.classList).toContain('min-h-11');
        expect(c.classList).toContain('focus-ring');
        expect(c.className).not.toContain('outline-none');
    });
});
