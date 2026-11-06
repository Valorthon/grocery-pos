import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import Index from './Index.vue';
import { useSettingsStore } from '@/stores/settings';
import { initialSettings } from '@/settings/presentation';
import { click, field, flush } from '@/testing/form-dom';
import api from '@/axios';
vi.mock('@/axios', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
let app: App | undefined;
let pinia = createPinia();
beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    localStorage.clear();
    useSettingsStore().setOwner('admin');
    vi.mocked(api.get).mockResolvedValue({
        data: { ...initialSettings, storeName: 'Current Shop' },
    });
});
afterEach(() => {
    app?.unmount();
    app = undefined;
    disposePinia(pinia);
    document.body.innerHTML = '';
    vi.clearAllMocks();
});
async function mount() {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/', component: Index }],
    });
    await router.push('/');
    await router.isReady();
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(Index);
    app.use(pinia);
    app.use(router);
    app.mount(host);
    await flush();
}
function input(label: string, value: string) {
    const el = field(label);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
}
it('shows persisted identity and the fixed owner policies', async () => {
    await mount();
    expect(field('Store name').value).toBe('Current Shop');
    expect(field('Currency').disabled).toBe(true);
    expect(document.body.textContent).toContain('Every discount still');
    expect(document.body.textContent).toContain('ADMIN PIN');
});
it('keeps edits after an API save failure and permits retry', async () => {
    await mount();
    input('Store name', 'New Shop');
    await flush();
    vi.mocked(api.patch).mockRejectedValueOnce(new Error('network'));
    await click('Save store settings');
    await flush();
    expect(field('Store name').value).toBe('New Shop');
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    vi.mocked(api.patch).mockResolvedValueOnce({
        data: { ...initialSettings, storeName: 'New Shop', version: 1 },
    });
    await click('Save store settings');
    await flush();
    expect(document.body.textContent).toContain('Store settings saved.');
    expect(api.patch).toHaveBeenLastCalledWith(
        '/settings',
        expect.objectContaining({
            version: 0,
            storeName: 'New Shop',
        }),
    );
    expect(
        vi.mocked(api.patch).mock.calls[
            vi.mocked(api.patch).mock.calls.length - 1
        ]?.[1],
    ).not.toHaveProperty('currency');
});
it('validates timezone and reorder fields before submitting', async () => {
    await mount();
    input('Store timezone (IANA)', 'No/SuchZone');
    await flush();
    await click('Save store settings');
    expect(api.patch).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('valid IANA');
    input('Store timezone (IANA)', 'Asia/Manila');
    input('Default reorder level for new products (display units)', '0.5');
    await flush();
    await click('Save store settings');
    expect(api.patch).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('whole-number');
});
it('holds duplicate saves while the first save remains pending', async () => {
    await mount();
    input('Store name', 'Pending');
    await flush();
    let resolve!: (value: { data: typeof initialSettings }) => void;
    vi.mocked(api.patch).mockReturnValueOnce(
        new Promise((done) => {
            resolve = done;
        }),
    );
    await click('Save store settings');
    expect(field('Store name').disabled).toBe(true);
    expect(api.patch).toHaveBeenCalledTimes(1);
    resolve({ data: { ...initialSettings, storeName: 'Pending', version: 1 } });
    await flush();
    expect(field('Store name').disabled).toBe(false);
});
it('locks settings edits until initial load settles, then saves with the loaded version', async () => {
    let resolve!: (value: { data: typeof initialSettings }) => void;
    vi.mocked(api.get).mockReturnValueOnce(
        new Promise((done) => {
            resolve = done;
        }),
    );
    await mount();
    expect(field('Store name').disabled).toBe(true);
    expect(field('Store timezone (IANA)').disabled).toBe(true);
    expect(
        field('Default reorder level for new products (display units)')
            .disabled,
    ).toBe(true);
    expect(
        Array.from(document.querySelectorAll('button')).find(
            (button) => button.textContent?.trim() === 'Save store settings',
        )?.disabled,
    ).toBe(true);
    expect(api.patch).not.toHaveBeenCalled();
    resolve({
        data: { ...initialSettings, storeName: 'Loaded Shop', version: 7 },
    });
    await flush();
    expect(field('Store name').disabled).toBe(false);
    expect(field('Store name').value).toBe('Loaded Shop');
    input('Store name', 'My edits');
    await flush();
    vi.mocked(api.patch).mockResolvedValueOnce({
        data: { ...initialSettings, storeName: 'My edits', version: 8 },
    });
    await click('Save store settings');
    await flush();
    expect(api.patch).toHaveBeenLastCalledWith(
        '/settings',
        expect.objectContaining({ version: 7, storeName: 'My edits' }),
    );
});
it('loads the server version when the owner is set after mount (fresh page load, #139)', async () => {
    useSettingsStore().setOwner(undefined);
    vi.mocked(api.get).mockResolvedValueOnce({
        data: { ...initialSettings, storeName: 'Loaded Shop', version: 4 },
    });
    await mount();
    expect(api.get).not.toHaveBeenCalled();
    expect(field('Store name').disabled).toBe(true);
    useSettingsStore().setOwner('admin');
    await flush();
    expect(field('Store name').value).toBe('Loaded Shop');
    input('Store name', 'Edited');
    await flush();
    vi.mocked(api.patch).mockResolvedValueOnce({
        data: { ...initialSettings, storeName: 'Edited', version: 5 },
    });
    await click('Save store settings');
    await flush();
    expect(api.patch).toHaveBeenLastCalledWith(
        '/settings',
        expect.objectContaining({ version: 4, storeName: 'Edited' }),
    );
});
