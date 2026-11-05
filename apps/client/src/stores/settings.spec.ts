import { beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSettingsStore } from './settings';
import {
    initialSettings,
    storePresentation,
    saveTerminalLabel,
    terminalLabel,
    validSettings,
} from '@/settings/presentation';
import api from '@/axios';
vi.mock('@/axios', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
    storePresentation.value = { ...initialSettings };
});
it('loads durable last-known presentation per owner and ignores malformed caches', async () => {
    const store = useSettingsStore();
    localStorage.setItem(
        'grocery_pos_settings_v1:a',
        JSON.stringify({ ...initialSettings, storeName: 'Cached' }),
    );
    store.setOwner('a');
    expect(store.settings.storeName).toBe('Cached');
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    await store.refresh();
    expect(store.settings.storeName).toBe('Cached');
    expect(store.error).toContain('last-known');
    localStorage.setItem('grocery_pos_settings_v1:b', '{');
    store.setOwner('b');
    expect(store.settings.storeName).toBe('Grocery POS');
});
it('shares concurrent refreshes and ignores responses after owner changes', async () => {
    let resolve!: (value: { data: typeof initialSettings }) => void;
    vi.mocked(api.get).mockReturnValueOnce(
        new Promise((done) => {
            resolve = done;
        }),
    );
    const store = useSettingsStore();
    store.setOwner('a');
    const one = store.refresh();
    const two = store.refresh();
    expect(api.get).toHaveBeenCalledTimes(1);
    store.setOwner('b');
    resolve({ data: { ...initialSettings, storeName: 'Old account' } });
    await Promise.all([one, two]);
    expect(store.settings.storeName).toBe('Grocery POS');
    expect(store.loading).toBe(false);
});
it('validates responses and applies an audited save only to the active owner', async () => {
    const store = useSettingsStore();
    store.setOwner('a');
    vi.mocked(api.get).mockResolvedValueOnce({
        data: { ...initialSettings, currency: 'USD' },
    });
    await store.refresh();
    expect(store.error).not.toBe('');
    vi.mocked(api.patch).mockResolvedValueOnce({
        data: { ...initialSettings, storeName: 'Saved', version: 1 },
    });
    expect(await store.save({ version: 0, storeName: 'Saved' })).toBe(true);
    expect(store.settings.storeName).toBe('Saved');
    expect(
        JSON.parse(localStorage.getItem('grocery_pos_settings_v1:a') ?? '{}'),
    ).toMatchObject({ storeName: 'Saved' });
    store.setOwner();
    expect(store.settings.storeName).toBe('Grocery POS');
});
it('bounds display-only terminal labels and preserves them when storage fails', () => {
    expect(saveTerminalLabel('  Lane 8  ')).toBe(true);
    expect(terminalLabel.value).toBe('Lane 8');
    expect(saveTerminalLabel('')).toBe(false);
    expect(saveTerminalLabel('x'.repeat(81))).toBe(false);
    const storage = vi
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementationOnce(() => {
            throw new Error('full');
        });
    expect(saveTerminalLabel('Lane 9')).toBe(false);
    expect(terminalLabel.value).toBe('Lane 8');
    storage.mockRestore();
});
it.each([
    null,
    {},
    { ...initialSettings, timezone: 'Invalid/Zone' },
    { ...initialSettings, version: -1 },
    { ...initialSettings, defaultReorderLevel: 0.1 },
])('rejects untrusted settings cache %j', (value) => {
    expect(validSettings(value)).toBe(false);
});
