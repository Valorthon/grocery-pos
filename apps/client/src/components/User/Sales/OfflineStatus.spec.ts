import { createApp, h, nextTick, reactive, type App } from 'vue';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { inFooter } from '@/testing/form-dom';
import {
    offlineTerminalSuffix,
    Role,
    STRING_LIMITS,
} from '@grocery-pos/contracts';
import OfflineStatus from './OfflineStatus.vue';

const mock = vi.hoisted(() => ({
    status: null as unknown,
    auth: { user: { userId: 'seller', roles: ['SELLER'] } },
    shifts: { activeShift: { _id: 'shift' } },
}));
vi.mock('@/stores/offline', () => ({ useOfflineStore: () => mock.status }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mock.auth }));
vi.mock('@/stores/shift', () => ({ useShiftStore: () => mock.shifts }));
function fixture() {
    return reactive({
        offline: false,
        ready: true,
        connected: true,
        pending: [] as Array<{
            owner: string;
            request: { idempotencyKey: string; soldAt: string };
            receipt: { cashierName: string; totalAmount: number };
            blocked?: string;
        }>,
        error: '',
        pendingOpen: false,
        busy: false,
        admin: false,
        clockOffset: 0,
        state: null as { terminalId: string; lease?: object } | null,
        clockWarning: false,
        setConnection: vi.fn(),
        probe: vi.fn().mockResolvedValue(true),
        prepare: vi.fn().mockResolvedValue(undefined),
        sync: vi.fn().mockResolvedValue(undefined),
        refreshPending: vi.fn().mockResolvedValue(undefined),
        reconcileEntry: vi.fn().mockResolvedValue(undefined),
        remeasureClock: vi.fn().mockResolvedValue(undefined),
    });
}
let status: ReturnType<typeof fixture>;
let app: App;
let root: HTMLElement;
const flush = async () => {
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();
    await nextTick();
};
function mount() {
    root = document.createElement('div');
    document.body.append(root);
    app = createApp({ render: () => h(OfflineStatus) });
    app.mount(root);
}
const pending = () => ({
    owner: 'seller',
    request: { idempotencyKey: 'key', soldAt: '2026-11-03T10:00:00.000Z' },
    receipt: { cashierName: 'Cashier', totalAmount: 8100 },
    blocked: 'Admin review required',
});
beforeEach(() => {
    status = fixture();
    mock.status = status;
    mock.auth = reactive({ user: { userId: 'seller', roles: [Role.Seller] } });
    vi.useFakeTimers();
});
afterEach(() => {
    app?.unmount();
    root?.remove();
    vi.useRealTimers();
});
it('shows readiness before the terminal loses its network', () => {
    mount();
    expect(root.textContent).toContain('Offline cash ready');
});
it('explains offline cash restrictions and missing readiness', async () => {
    status.offline = true;
    mount();
    expect(root.textContent).toContain('no discounts');
    status.ready = false;
    await flush();
    expect(root.textContent).toContain('Reconnect before selling');
});
it('opens pending collected cash without offering destructive discard', async () => {
    status.pending = [pending()];
    mount();
    Array.from(root.querySelectorAll('button'))
        .find((b) => b.textContent?.includes('Review pending'))!
        .click();
    await flush();
    expect(document.body.textContent).toContain(
        'Do not charge the customer again',
    );
    expect(document.body.textContent).toContain('log in on this terminal');
    // #328: the key is labelled as a key, never as a sale number.
    expect(document.body.textContent).toContain('Pending sale key key');
    expect(
        Array.from(document.body.querySelectorAll('button')).some((b) =>
            b.textContent?.includes('Discard'),
        ),
    ).toBe(false);
});
it('syncs explicitly and automatically when the connection returns', async () => {
    status.pending = [pending()];
    mount();
    Array.from(root.querySelectorAll('button'))
        .find((b) => b.textContent?.includes('Sync now'))!
        .click();
    await flush();
    expect(status.prepare).toHaveBeenCalledWith(mock.shifts.activeShift);
    expect(status.sync).toHaveBeenCalled();
    status.probe.mockClear();
    window.dispatchEvent(new Event('offline'));
    // The browser's offline event is a hint: the API decides (#359).
    expect(status.probe).toHaveBeenCalledTimes(1);
    expect(status.setConnection).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(status.refreshPending).toHaveBeenCalled();
});
it('probes the API once as soon as it mounts', () => {
    mount();
    expect(status.probe).toHaveBeenCalledTimes(1);
});
it('does not prepare or sync while the API does not answer', async () => {
    status.probe.mockResolvedValue(false);
    mount();
    await vi.advanceTimersByTimeAsync(30000);
    expect(status.probe).toHaveBeenCalled();
    expect(status.prepare).not.toHaveBeenCalled();
    expect(status.sync).not.toHaveBeenCalled();
});
it('refreshes periodically and removes its listeners/timer after unmount', async () => {
    mount();
    await vi.advanceTimersByTimeAsync(30000);
    expect(status.sync).toHaveBeenCalledTimes(1);
    app.unmount();
    await vi.advanceTimersByTimeAsync(30000);
    expect(status.sync).toHaveBeenCalledTimes(1);
});
// #459 (owner 2026-11-23): a failed probe retries every 5 s flat.
it('retries every 5 s while offline and returns to 30 s after a success', async () => {
    status.probe.mockResolvedValue(false);
    mount();
    await flush();
    expect(status.probe).toHaveBeenCalledTimes(1);
    const after = async (ms: number, calls: number) => {
        await vi.advanceTimersByTimeAsync(ms - 1);
        expect(status.probe).toHaveBeenCalledTimes(calls - 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(status.probe).toHaveBeenCalledTimes(calls);
    };
    // After 1, 3 and 10 consecutive failures the next probe is 5 s later.
    for (let calls = 2; calls <= 11; calls++) await after(5000, calls);
    status.probe.mockResolvedValue(true);
    await after(5000, 12);
    expect(status.sync).toHaveBeenCalledTimes(1);
    await after(30000, 13);
    await after(30000, 14);
    status.probe.mockResolvedValue(false);
    await after(30000, 15);
    await after(5000, 16);
});
it('notices a recovery after a 60 s outage within 5 s', async () => {
    status.probe.mockResolvedValue(false);
    mount();
    await vi.advanceTimersByTimeAsync(60000);
    expect(status.sync).not.toHaveBeenCalled();
    status.probe.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(status.sync).toHaveBeenCalledTimes(1);
});
it('keeps the 30 s cadence when the API answers but sync fails', async () => {
    status.sync.mockRejectedValue(new Error('409'));
    mount();
    await vi.advanceTimersByTimeAsync(30000);
    expect(status.sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29999);
    expect(status.probe).toHaveBeenCalledTimes(2);
    expect(status.sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(status.sync).toHaveBeenCalledTimes(2);
});
it('counts the retry delay after a slow failed probe finishes', async () => {
    let resolve!: (ok: boolean) => void;
    status.probe.mockImplementation(
        () => new Promise<boolean>((r) => (resolve = r)),
    );
    mount();
    await vi.advanceTimersByTimeAsync(8000);
    resolve(false);
    await flush();
    await vi.advanceTimersByTimeAsync(4999);
    expect(status.probe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(status.probe).toHaveBeenCalledTimes(2);
});
it('never overlaps probes and runs one queued follow-up', async () => {
    let resolve!: (ok: boolean) => void;
    status.probe.mockImplementation(
        () => new Promise<boolean>((r) => (resolve = r)),
    );
    mount();
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('offline'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(status.probe).toHaveBeenCalledTimes(1);
    // The queued follow-up (the online retry wins) runs at once.
    resolve(false);
    await flush();
    expect(status.probe).toHaveBeenCalledTimes(2);
    resolve(true);
    await flush();
    await flush();
    expect(status.sync).toHaveBeenCalledTimes(1);
    // Its success resets the cadence to 30 s.
    status.probe.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(29999);
    expect(status.probe).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(status.probe).toHaveBeenCalledTimes(3);
});
it('syncs an online event that arrives mid-probe without waiting 30 s', async () => {
    let resolve!: (ok: boolean) => void;
    status.probe.mockImplementation(
        () => new Promise<boolean>((r) => (resolve = r)),
    );
    mount();
    window.dispatchEvent(new Event('online'));
    resolve(true);
    await flush();
    resolve(true);
    await flush();
    await flush();
    expect(status.sync).toHaveBeenCalledTimes(1);
});
it('syncs at once when a plain probe succeeds after failures', async () => {
    status.probe.mockResolvedValue(false);
    mount();
    await flush();
    status.probe.mockResolvedValue(true);
    window.dispatchEvent(new Event('offline'));
    await flush();
    await flush();
    await flush();
    expect(status.sync).toHaveBeenCalledTimes(1);
});
it('stops probing on logout', async () => {
    const auth = mock.auth as { user: typeof mock.auth.user | null };
    mount();
    await flush();
    auth.user = null;
    await flush();
    await vi.advanceTimersByTimeAsync(120000);
    expect(status.probe).toHaveBeenCalledTimes(1);
});
it('lets an admin explicitly reconcile a collected cash record with a required reason', async () => {
    status.admin = true;
    status.pending = [pending()];
    status.pendingOpen = true;
    mount();
    await flush();
    const input = document.body.querySelector('input')!;
    expect(input.maxLength).toBe(STRING_LIMITS.REASON);
    input.value = 'Counted original cash';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    const button = Array.from(document.body.querySelectorAll('button')).find(
        (b) => b.textContent?.includes('Record collected'),
    )!;
    button.click();
    await flush();
    expect(status.reconcileEntry).toHaveBeenCalledWith(
        status.pending[0],
        'Counted original cash',
    );
});
it.each([new Error('Server unavailable'), 'unexpected error'])(
    'keeps a failed admin reconciliation visible and pending',
    async (failure) => {
        status.admin = true;
        status.pending = [pending()];
        status.pendingOpen = true;
        status.reconcileEntry.mockRejectedValue(failure);
        mount();
        await flush();
        const input = document.body.querySelector('input')!;
        input.value = 'Verified';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await flush();
        Array.from(document.body.querySelectorAll('button'))
            .find((b) => b.textContent?.includes('Record collected'))!
            .click();
        await flush();
        expect(document.body.textContent).toContain(
            failure instanceof Error ? failure.message : 'sale is kept',
        );
        expect(inFooter('offline-pending-error')).toBe(true);
        status.pendingOpen = false;
        await flush();
        status.pendingOpen = true;
        await flush();
        expect(
            document.querySelector('[data-testid="offline-pending-error"]'),
        ).toBeNull();
        expect(status.pending).toHaveLength(1);
    },
);
it('shows an empty pending list and handles a non-seller admin without preparing a selling lease', async () => {
    status.pendingOpen = true;
    mock.auth.user.roles = [Role.Admin];
    mount();
    await flush();
    expect(document.body.textContent).toContain('No pending sales');
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(status.prepare).not.toHaveBeenCalled();
});

it('warns when the terminal clock is far off the main PC (#398)', async () => {
    mount();
    expect(root.querySelector('[data-testid="offline-clock-warning"]')).toBe(
        null,
    );
    status.ready = false;
    status.clockOffset = -45_000;
    status.clockWarning = true;
    await flush();
    const warning = root.querySelector('[data-testid="offline-clock-warning"]');
    expect(warning?.textContent).toContain('45 seconds off the main PC');
    status.clockOffset = 300_000;
    await flush();
    expect(warning?.textContent).toContain('5 min off');
});

it("shows this browser's terminal id as the End-shift refusal names it (#454)", () => {
    const terminalId = '3f2a1b4c-0000-4000-8000-00ab12cd34ef';
    status.state = { terminalId };
    mount();
    const shown = root.querySelector('[data-testid="offline-terminal-id"]');
    expect(shown?.textContent).toBe(
        `Your terminal id ${offlineTerminalSuffix(terminalId)}`,
    );
    expect(shown?.textContent).toBe('Your terminal id 12CD34EF');
});
it('shows no terminal id before offline mode created one (#454)', () => {
    mount();
    expect(
        root.querySelector('[data-testid="offline-terminal-id"]'),
    ).toBeNull();
});
it('shows the id while a lease exists before the catalogue is ready (#454)', () => {
    status.ready = false;
    status.state = {
        terminalId: '3f2a1b4c-0000-4000-8000-00ab12cd34ef',
        lease: {},
    };
    mount();
    expect(
        root.querySelector('[data-testid="offline-terminal-id"]')?.textContent,
    ).toBe('Your terminal id 12CD34EF');
});

it('measures the clock again on focus and when the tab becomes visible (#533)', () => {
    mount();
    window.dispatchEvent(new Event('focus'));
    expect(status.remeasureClock).toHaveBeenCalledTimes(1);
    const visibility = vi
        .spyOn(document, 'visibilityState', 'get')
        .mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(status.remeasureClock).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(status.remeasureClock).toHaveBeenCalledTimes(2);
    mock.auth.user = null as never;
    window.dispatchEvent(new Event('focus'));
    expect(status.remeasureClock).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
});
it('stops measuring on focus after unmount (#533)', () => {
    mount();
    app.unmount();
    window.dispatchEvent(new Event('focus'));
    expect(status.remeasureClock).not.toHaveBeenCalled();
});
