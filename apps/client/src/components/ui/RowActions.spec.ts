import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h, ref } from 'vue';
import { flush } from '@/testing/form-dom';
import RowActions from './RowActions.vue';
import type { RowAction } from './row-actions';

let app: App | null = null;
afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

/** Rows inside a clipping table box, like BaseTable's (#172). */
function mount(names: string[], actions: (name: string) => RowAction[]) {
    const rows = ref(names);
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({
        render: () =>
            h('main', [
                h('div', { class: 'overflow-hidden', id: 'clip' }, [
                    h('div', { class: 'overflow-x-auto' }, [
                        h('table', [
                            h(
                                'tbody',
                                rows.value.map((name) =>
                                    h('tr', { key: name }, [
                                        h('td', [
                                            h(RowActions, {
                                                label: name,
                                                actions: actions(name),
                                            }),
                                        ]),
                                    ]),
                                ),
                            ),
                        ]),
                    ]),
                ]),
            ]),
    });
    app.mount(host);
    return rows;
}
const trigger = (name: string) =>
    document.querySelector<HTMLButtonElement>(
        `button[aria-label="Actions for ${name}"]`,
    )!;
const menu = () => document.querySelector<HTMLElement>('[role=menu]');
const key = async (name: string) => {
    document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: name, bubbles: true }),
    );
    await flush();
};

describe('RowActions (#172)', () => {
    it('renders the menu outside the table box, below the trigger', async () => {
        mount(['milk'], () => [{ label: 'Edit', onSelect: vi.fn() }]);
        trigger('milk').click();
        await flush();
        expect(menu()).not.toBeNull();
        expect(document.getElementById('clip')!.contains(menu())).toBe(false);
        expect(menu()!.className).toContain('fixed');
        expect(menu()!.dataset.placement).toBe('below');
        expect(menu()!.style.top).not.toBe('');
    });
    it('flips above the trigger when there is no room below', async () => {
        mount(['milk'], () => [{ label: 'Edit', onSelect: vi.fn() }]);
        vi.spyOn(trigger('milk'), 'getBoundingClientRect').mockReturnValue(
            DOMRect.fromRect({
                x: 900,
                y: window.innerHeight - 50,
                width: 44,
                height: 44,
            }),
        );
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(
            150,
        );
        trigger('milk').click();
        await flush();
        expect(menu()!.dataset.placement).toBe('above');
        expect(menu()!.style.bottom).not.toBe('');
        expect(menu()!.style.top).toBe('');
    });
    it('aligns to the trigger right edge, kept 8px inside the viewport (#298)', async () => {
        mount(['milk'], () => [{ label: 'Edit', onSelect: vi.fn() }]);
        vi.spyOn(trigger('milk'), 'getBoundingClientRect').mockReturnValue(
            DOMRect.fromRect({ x: 1000, y: 100, width: 44, height: 44 }),
        );
        vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(
            192,
        );
        vi.spyOn(
            document.documentElement,
            'clientWidth',
            'get',
        ).mockReturnValue(1024);
        trigger('milk').click();
        await flush();
        // Right edge 1044 - 192 = 852, clamped to 1024 - 192 - 8 = 824.
        expect(menu()!.style.left).toBe('824px');
        expect(menu()!.style.right).toBe('');
    });
    it('is keyboard operable and skips disabled items', async () => {
        const run = vi.fn();
        mount(['milk'], () => [
            { label: 'History', onSelect: vi.fn() },
            { label: 'Edit', onSelect: vi.fn(), disabled: true },
            { label: 'Archive', onSelect: run },
        ]);
        trigger('milk').focus();
        await key('ArrowDown');
        expect(document.activeElement?.textContent?.trim()).toBe('History');
        await key('ArrowDown');
        expect(document.activeElement?.textContent?.trim()).toBe('Archive');
        await key('ArrowDown');
        expect(document.activeElement?.textContent?.trim()).toBe('History');
        await key('End');
        (document.activeElement as HTMLButtonElement).click();
        await flush();
        expect(run).toHaveBeenCalledOnce();
        expect(document.activeElement).toBe(trigger('milk'));
        await key('ArrowDown');
        await key('Escape');
        expect(document.activeElement).toBe(trigger('milk'));
    });
    it('moves the focus to the next row when the row goes away', async () => {
        const rows = mount(['a', 'b', 'c'], (name) => [
            {
                label: 'Delete',
                onSelect: () =>
                    (rows.value = rows.value.filter((row) => row !== name)),
            },
        ]);
        trigger('b').click();
        await flush();
        document.querySelector<HTMLButtonElement>('[role=menuitem]')!.click();
        await flush();
        await vi.waitFor(() =>
            expect(document.activeElement).toBe(trigger('c')),
        );
    });
    it('holds the focus on the table while rows reload, then lands on the same position', async () => {
        const rows = mount(['a', 'b'], () => [
            { label: 'Archive', onSelect: () => (rows.value = []) },
        ]);
        trigger('b').click();
        await flush();
        document.querySelector<HTMLButtonElement>('[role=menuitem]')!.click();
        await flush();
        await vi.waitFor(() =>
            expect(document.activeElement?.className).toBe('overflow-x-auto'),
        );
        rows.value = ['a', 'b'];
        await flush();
        await vi.waitFor(() =>
            expect(document.activeElement).toBe(trigger('b')),
        );
    });
});
