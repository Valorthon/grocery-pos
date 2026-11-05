import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, ref, type App } from 'vue';
import CategorySelect from './CategorySelect.vue';
import { flush } from '@/testing/form-dom';
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
let app: App | undefined;
const rows = [
    { _id: 'a', name: 'Dairy', isActive: true },
    { _id: 'b', name: 'Old', isActive: false },
];
beforeEach(() => {
    api.get.mockResolvedValue({ data: { data: rows, totalItems: 2 } });
});
afterEach(() => {
    app?.unmount();
    document.body.innerHTML = '';
});
async function mount(current?: string) {
    const value = ref<string | undefined>(current);
    const refreshKey = ref(false);
    app = createApp(
        defineComponent({
            setup: () => () =>
                h(CategorySelect, {
                    modelValue: value.value,
                    'onUpdate:modelValue': (next: string | undefined) => {
                        value.value = next;
                    },
                    current,
                    refreshKey: refreshKey.value,
                }),
        }),
    );
    const host = document.createElement('div');
    document.body.append(host);
    app.mount(host);
    await flush();
    return { value, refreshKey };
}
it('loads dynamic active choices, preserves current archived assignment and can explicitly clear', async () => {
    const state = await mount('b');
    const select = document.querySelector('select')!;
    expect([...select.options].map((o) => o.textContent)).toEqual([
        'Uncategorized',
        'Dairy',
        'Old (archived)',
    ]);
    select.value = '';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(state.value.value).toBeUndefined();
    select.value = 'a';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(state.value.value).toBe('a');
});
it('hides archived choices from new assignments, refreshes on form open', async () => {
    const state = await mount();
    expect(document.body.textContent).not.toContain('Old');
    state.refreshKey.value = true;
    await flush();
    expect(api.get).toHaveBeenCalledTimes(2);
});
it('shows category load errors and retries without losing selection', async () => {
    api.get.mockRejectedValueOnce(new Error('offline'));
    const state = await mount('b');
    expect(document.querySelector('[role=alert]')).not.toBeNull();
    expect(document.querySelector('select')?.disabled).toBe(true);
    expect(state.value.value).toBe('b');
    document.querySelector('button')?.click();
    await flush();
    expect(document.querySelector('[role=alert]')).toBeNull();
    expect(state.value.value).toBe('b');
});
it('loads all bounded pages and ignores late responses after unmount', async () => {
    api.get
        .mockResolvedValueOnce({
            data: { data: rows.slice(0, 1), totalItems: 2 },
        })
        .mockResolvedValueOnce({
            data: { data: rows.slice(1), totalItems: 2 },
        });
    await mount('b');
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('Old');
    let finish!: (v: unknown) => void;
    api.get.mockReturnValue(
        new Promise((resolve) => {
            finish = resolve;
        }),
    );
    const state = await mount();
    app?.unmount();
    finish({ data: { data: rows, totalItems: 2 } });
    await flush();
    expect(state.value.value).toBeUndefined();
    app = undefined;
});
