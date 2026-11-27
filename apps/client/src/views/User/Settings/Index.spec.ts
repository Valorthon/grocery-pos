import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import Index from './Index.vue';
import { useSettingsStore } from '@/stores/settings';
import { initialSettings } from '@/settings/presentation';
import { click, field, flush } from '@/testing/form-dom';
import api from '@/axios';
import type { TerminalSeen } from '@grocery-pos/contracts';
import { useUIStore } from '@/stores/ui';
import {
    refreshSavedTerminalLabel,
    savedTerminalLabel,
} from '@/settings/presentation';
vi.mock('@/axios', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
let app: App | undefined;
let pinia = createPinia();
beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    localStorage.clear();
    useSettingsStore().setOwner('admin');
    vi.mocked(api.get).mockImplementation((url: string) =>
        Promise.resolve({
            data:
                url === '/shifts/terminals'
                    ? { terminals: seenRows }
                    : { ...initialSettings, storeName: 'Current Shop' },
        }),
    );
});
let seenRows: TerminalSeen[] = [];
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
    expect(
        document
            .querySelector('[data-testid="non-vat-notice"]')
            ?.textContent?.trim(),
    ).toBe(
        'Totals are non-VAT; this app computes no tax. VAT, SC/PWD discounts and BIR receipts are handled outside this app.',
    );
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
    expect(useUIStore().toasts.map((toast) => toast.lines)).toContainEqual([
        'Store settings saved.',
    ]);
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
    input('Default low stock level for new products (display units)', '0.5');
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
        field('Default low stock level for new products (display units)')
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
it('labels the footer "Sale summary footer" (#328)', async () => {
    await mount();
    expect(field('Sale summary footer')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Receipt footer');
});
it('edits the expiry alert window with the API bounds (#213)', async () => {
    await mount();
    const label = 'Expiry alert window (days)';
    expect(field(label).value).toBe('7');
    for (const bad of ['0', '91', '2.5', ' ']) {
        input(label, bad);
        await flush();
        await click('Save store settings');
        expect(api.patch).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain(
            'whole number of expiry alert days from 1 to 90',
        );
    }
    vi.mocked(api.patch).mockResolvedValueOnce({
        data: {
            ...initialSettings,
            storeName: 'Current Shop',
            expiryAlertDays: 30,
            version: 1,
        },
    });
    input(label, '30');
    await flush();
    await click('Save store settings');
    await flush();
    expect(api.patch).toHaveBeenCalledWith(
        '/settings',
        expect.objectContaining({ version: 0, expiryAlertDays: 30 }),
    );
    expect(field(label).value).toBe('30');
});

// ------------------------------------------------ This terminal (#502)

function terminalSection() {
    return document.querySelector('[data-testid="this-terminal"]')!;
}
it('shows "Not set" and an empty field on a fresh terminal (#502)', async () => {
    refreshSavedTerminalLabel();
    await mount();
    expect(field('Terminal / lane label').value).toBe('');
    expect(
        document.querySelector('[data-testid="terminal-state"]')?.textContent,
    ).toContain('Not set');
    expect(terminalSection().textContent).not.toContain('Lane #1');
    expect(terminalSection().textContent).toContain(
        "Saved in this PC's browser only; set it on each terminal",
    );
    expect(
        document.querySelector('[data-testid="device-address"]')?.textContent,
    ).toContain(window.location.host);
});
it('saves the label with a success toast (#502)', async () => {
    refreshSavedTerminalLabel();
    await mount();
    input('Terminal / lane label', '  Lane 3 ');
    await flush();
    await click('Save terminal label');
    await flush();
    expect(localStorage.getItem('grocery_pos_terminal_label_v1')).toBe(
        'Lane 3',
    );
    expect(savedTerminalLabel.value).toBe('Lane 3');
    expect(
        document.querySelector('[data-testid="terminal-state"]')?.textContent,
    ).toContain('Lane 3');
    expect(useUIStore().toasts.map((toast) => toast.lines)).toContainEqual([
        'Terminal label saved.',
    ]);
});
it('shows a visible error when browser storage refuses the label (#502)', async () => {
    refreshSavedTerminalLabel();
    await mount();
    input('Terminal / lane label', 'Lane 4');
    await flush();
    const storage = vi
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => {
            throw new Error('full');
        });
    await click('Save terminal label');
    await flush();
    storage.mockRestore();
    expect(terminalSection().textContent).toContain(
        "Couldn't save the label in this browser's storage",
    );
    expect(savedTerminalLabel.value).toBe('');
    expect(useUIStore().toasts).toHaveLength(0);
});
it('offers no save for a blank label (#502)', async () => {
    refreshSavedTerminalLabel();
    await mount();
    input('Terminal / lane label', '   ');
    await flush();
    const save = Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Save terminal label',
    );
    expect(save?.disabled).toBe(true);
});
it('lists the terminals seen from the server, read-only (#502)', async () => {
    seenRows = [
        {
            label: 'Lane 2',
            lastSeenAt: '2026-11-27T01:00:00.000Z',
            shifts: 3,
            offlineLeases: 1,
        },
    ];
    await mount();
    seenRows = [];
    expect(api.get).toHaveBeenCalledWith('/shifts/terminals');
    const list = document.querySelector('[data-testid="terminals-seen"]')!;
    expect(list.textContent).toContain('Lane 2');
    expect(list.textContent).toContain('3 shifts');
    expect(list.textContent).toContain('1 offline session');
    expect(list.querySelector('input, button')).toBeNull();
});
it('shows a Retry when the terminals seen list fails (#502)', async () => {
    const settingsAnswer = { data: { ...initialSettings } };
    vi.mocked(api.get)
        .mockResolvedValueOnce(settingsAnswer)
        .mockRejectedValueOnce(new Error('network'));
    await mount();
    const list = document.querySelector('[data-testid="terminals-seen"]')!;
    expect(list.querySelector('[role="alert"]')).not.toBeNull();
    await click('Retry');
    await flush();
    expect(list.querySelector('[role="alert"]')).toBeNull();
    expect(list.textContent).toContain('No terminals yet.');
});
it('warns when the browser looks like Guest/Incognito (#502)', async () => {
    Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: { estimate: () => Promise.resolve({ quota: 50 * 1024 * 1024 }) },
    });
    try {
        await mount();
        await flush();
        expect(
            document.querySelector('[data-testid="ephemeral-warning"]')
                ?.textContent,
        ).toContain('Guest or Incognito');
    } finally {
        Reflect.deleteProperty(navigator, 'storage');
    }
});
it('shows no Guest/Incognito warning in a normal window (#502)', async () => {
    await mount();
    expect(
        document.querySelector('[data-testid="ephemeral-warning"]'),
    ).toBeNull();
});
