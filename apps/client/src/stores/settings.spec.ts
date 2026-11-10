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
it('keeps a successful save and its durable timezone when an older refresh resolves', async () => {
    let resolve!: (value: { data: typeof initialSettings }) => void;
    vi.mocked(api.get).mockReturnValueOnce(
        new Promise((done) => {
            resolve = done;
        }),
    );
    const store = useSettingsStore();
    store.setOwner('a');
    const refreshing = store.refresh();
    const saved = {
        ...initialSettings,
        storeName: 'New Shop',
        timezone: 'UTC',
        version: 1,
    };
    vi.mocked(api.patch).mockResolvedValueOnce({ data: saved });
    expect(await store.save({ version: 0, storeName: saved.storeName })).toBe(
        true,
    );
    resolve({ data: { ...initialSettings, storeName: 'Old Shop' } });
    await refreshing;
    expect(store.settings).toEqual(saved);
    expect(storePresentation.value.timezone).toBe('UTC');
    expect(
        JSON.parse(localStorage.getItem('grocery_pos_settings_v1:a') ?? 'null'),
    ).toEqual(saved);
    expect(store.loading).toBe(false);
    expect(store.error).toBe('');
    vi.mocked(api.get).mockResolvedValueOnce({
        data: { ...saved, version: 2, storeName: 'Newest' },
    });
    await store.refresh();
    expect(store.settings.storeName).toBe('Newest');
});
it('does not apply an older version than the cached settings and suppresses pre-save refresh errors', async () => {
    const store = useSettingsStore();
    localStorage.setItem(
        'grocery_pos_settings_v1:a',
        JSON.stringify({
            ...initialSettings,
            version: 3,
            storeName: 'Cached newer',
        }),
    );
    store.setOwner('a');
    vi.mocked(api.get).mockResolvedValueOnce({ data: initialSettings });
    await store.refresh();
    expect(store.settings.storeName).toBe('Cached newer');
    let reject!: (cause: Error) => void;
    vi.mocked(api.get).mockReturnValueOnce(
        new Promise((_done, fail) => {
            reject = fail;
        }),
    );
    const refreshing = store.refresh();
    vi.mocked(api.patch).mockResolvedValueOnce({
        data: { ...initialSettings, version: 4 },
    });
    await store.save({ version: 3, storeName: 'Grocery POS' });
    reject(new Error('obsolete GET failure'));
    await refreshing;
    expect(store.error).toBe('');
    expect(store.settings.version).toBe(4);
});
it('ignores a pending save after changing owners without touching either owner cache', async () => {
    let resolve!: (value: { data: typeof initialSettings }) => void;
    vi.mocked(api.patch).mockReturnValueOnce(
        new Promise((done) => {
            resolve = done;
        }),
    );
    const store = useSettingsStore();
    store.setOwner('a');
    const saving = store.save({ version: 0, storeName: 'A' });
    store.setOwner('b');
    resolve({ data: { ...initialSettings, storeName: 'A', version: 1 } });
    expect(await saving).toBe(false);
    expect(store.settings.storeName).toBe('Grocery POS');
    expect(localStorage.getItem('grocery_pos_settings_v1:a')).toBeNull();
    expect(localStorage.getItem('grocery_pos_settings_v1:b')).toBeNull();
});
it('reads a cache saved before the expiry window existed as 7 days (#213)', () => {
    const { expiryAlertDays: _drop, ...legacy } = {
        ...initialSettings,
        storeName: 'Legacy Shop',
        version: 3,
    };
    void _drop;
    localStorage.setItem('grocery_pos_settings_v1:old', JSON.stringify(legacy));
    const store = useSettingsStore();
    store.setOwner('old');
    expect(store.settings).toMatchObject({
        storeName: 'Legacy Shop',
        expiryAlertDays: 7,
    });
    localStorage.setItem(
        'grocery_pos_settings_v1:bad',
        JSON.stringify({ ...legacy, expiryAlertDays: 0 }),
    );
    store.setOwner('bad');
    expect(store.settings.storeName).toBe('Grocery POS');
});
