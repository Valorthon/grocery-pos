import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, h } from 'vue';
import { flush } from '@/testing/form-dom';
import FilterBar from './FilterBar.vue';
import { COMPACT_HEIGHT } from './filter-bar';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

function mountBar(
    props: Record<string, unknown>,
    withMore = true,
): HTMLElement {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({
        render: () =>
            h(
                FilterBar,
                { compact: true, ...props },
                {
                    default: () => h('select', { 'aria-label': 'Payment' }),
                    ...(withMore
                        ? {
                              more: () =>
                                  h('select', {
                                      id: 'more-cashier',
                                      'aria-label': 'Cashier',
                                  }),
                          }
                        : {}),
                },
            ),
    });
    app.mount(host);
    return host;
}

const row = () => document.querySelector<HTMLElement>('[data-filter-row]')!;
const more = () =>
    document.querySelector<HTMLButtonElement>('[data-more-filters]');

describe('compact FilterBar (#254)', () => {
    it('gives fields and buttons one height and ends the row with Clear', () => {
        mountBar({ searchLabel: 'Sale number' });
        for (const cls of COMPACT_HEIGHT.split(' '))
            expect(row().classList).toContain(cls);
        for (const button of row().querySelectorAll('button'))
            expect(button.classList).toContain('min-h-11');
        expect(row().lastElementChild?.textContent?.trim()).toBe(
            'Clear Filters',
        );
    });

    it('names the search box by aria-label and a placeholder, with no label above it', () => {
        mountBar({ searchLabel: 'Sale number' });
        const box = row().querySelector('input')!;
        expect(box.getAttribute('aria-label')).toBe('Sale number');
        expect(box.getAttribute('placeholder')).toBe('Sale number');
        expect(row().querySelector('label')).toBeNull();
    });

    it('counts only the applied filters it is given, and has no count at zero', () => {
        mountBar({ filtersCount: 0 });
        expect(more()?.textContent?.trim()).toBe('Filters');
        app?.unmount();
        document.body.innerHTML = '';
        mountBar({ filtersCount: 2 });
        expect(more()?.textContent?.trim()).toBe('Filters · 2');
    });

    it('omits the Filters button when nothing is left for it', () => {
        mountBar({}, false);
        expect(more()).toBeNull();
    });

    it('opens the Filters dialog on the modal stack; Escape closes it and the focus returns', async () => {
        mountBar({});
        const button = more()!;
        button.focus();
        button.click();
        await flush();
        const dialog = document.querySelector('[role="dialog"]')!;
        expect(dialog.querySelector('#more-cashier')).not.toBeNull();
        expect(button.getAttribute('aria-expanded')).toBe('true');
        // The page behind the dialog is inert while it is open.
        expect(row().closest('[inert]')).not.toBeNull();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await flush();
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(button);
    });
});
