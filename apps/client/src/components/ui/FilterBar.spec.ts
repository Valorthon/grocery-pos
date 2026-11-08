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
    const state: { name: ReturnType<typeof ref<string>> } = {
        name: ref(''),
    };
    const Page = defineComponent({
        setup() {
            const name = state.name;
            const category = ref<string | null>('dairy');
            const { search } = useListPaging(load);
            const { applied, apply } = useAppliedFilters(
                () => ({ name: name.value ?? '', category: category.value }),
                search,
            );
            const chips = (): FilterChip[] => {
                const out: FilterChip[] = [];
                if (applied.value.name)
                    out.push({
                        key: 'name',
                        label: `Name: ${applied.value.name}`,
                    });
                if (applied.value.category)
                    out.push({
                        key: 'category',
                        label: `Category: ${applied.value.category}`,
                    });
                return out;
            };
            function remove(key: string) {
                if (key === 'name') name.value = '';
                else category.value = null;
                apply();
            }
            function clear() {
                name.value = '';
                category.value = null;
                apply();
            }
            return () =>
                h(
                    FilterBar,
                    {
                        search: name.value ?? '',
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
    return { host, load, name: state.name };
}

function chipLabels(host: HTMLElement): string[] {
    return [
        ...host.querySelectorAll<HTMLButtonElement>(
            'ul[aria-label="Applied filters"] button[aria-label^="Remove"]',
        ),
    ].map((b) => b.textContent!.trim());
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

describe('FilterBar (#157)', () => {
    it('chips show applied filters, never typed-but-unsearched text', async () => {
        const { host, load } = harness();
        await flush();
        expect(chipLabels(host)).toEqual(['Category: dairy']);

        const input = host.querySelector('input')!;
        await type(input, 'milk');
        expect(chipLabels(host)).toEqual(['Category: dairy']);
        expect(load).not.toHaveBeenCalled();

        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        await flush();
        expect(chipLabels(host)).toEqual(['Name: milk', 'Category: dairy']);
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

        const clear =
            host.querySelector<HTMLButtonElement>('.relative > button')!;
        clear.click();
        await flush();
        expect(load).toHaveBeenCalledTimes(2);
        expect(chipLabels(host)).toEqual(['Category: dairy']);
    });

    it('removing a chip runs one search() and drops that chip', async () => {
        const { host, load } = harness();
        await flush();
        host.querySelector<HTMLButtonElement>(
            'button[aria-label="Remove filter Category: dairy"]',
        )!.click();
        await flush();
        expect(load).toHaveBeenCalledTimes(1);
        expect(chipLabels(host)).toEqual([]);
        expect(host.querySelector('ul')).toBeNull();
    });

    it('Clear all resets every chip with one search()', async () => {
        const { host, load } = harness();
        await flush();
        await type(host.querySelector('input')!, 'tea');
        button(host, 'Search').click();
        await flush();
        load.mockClear();
        button(host, 'Clear all').click();
        await flush();
        expect(load).toHaveBeenCalledTimes(1);
        expect(chipLabels(host)).toEqual([]);
    });

    it('the Filters disclosure toggles with aria-expanded and shows the count', async () => {
        const { host } = harness();
        await flush();
        const toggle = button(host, 'Filters');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.textContent).toContain('1 active');
        const panel = document.getElementById(
            toggle.getAttribute('aria-controls')!,
        )!;
        expect(panel.style.display).toBe('none');
        expect(panel.querySelector('select')).not.toBeNull();

        toggle.focus();
        toggle.click(); // Enter/Space on a native button fire click.
        await flush();
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(panel.style.display).toBe('');
        expect(toggle.classList).toContain('focus-ring');
        expect(toggle.classList).toContain('min-h-11');
    });

    it('chip buttons are 44px targets with the focus ring', async () => {
        const { host } = harness();
        await flush();
        const chip = host.querySelector<HTMLButtonElement>(
            'button[aria-label^="Remove"]',
        )!;
        expect(chip.classList).toContain('min-h-11');
        expect(chip.classList).toContain('focus-ring');
        expect(chip.className).not.toContain('outline-none');
    });
});
