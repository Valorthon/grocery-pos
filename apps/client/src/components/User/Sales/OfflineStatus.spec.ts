import { createApp, h, nextTick, reactive, type App } from 'vue';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { inFooter } from '@/testing/form-dom';
import { Role, STRING_LIMITS } from '@grocery-pos/contracts';
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
        setConnection: vi.fn(),
        prepare: vi.fn().mockResolvedValue(undefined),
        sync: vi.fn().mockResolvedValue(undefined),
        refreshPending: vi.fn().mockResolvedValue(undefined),
        reconcileEntry: vi.fn().mockResolvedValue(undefined),
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
    mock.auth.user.roles = [Role.Seller];
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
    window.dispatchEvent(new Event('offline'));
    expect(status.setConnection).toHaveBeenCalledWith(false);
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(status.refreshPending).toHaveBeenCalled();
});
it('refreshes periodically and removes its listeners/timer after unmount', async () => {
    mount();
    await vi.advanceTimersByTimeAsync(30000);
    expect(status.sync).toHaveBeenCalledTimes(1);
    app.unmount();
    await vi.advanceTimersByTimeAsync(30000);
    expect(status.sync).toHaveBeenCalledTimes(1);
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
