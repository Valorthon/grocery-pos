import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import {
    AuditAction,
    Role,
    STRING_LIMITS,
    type AuditLogView,
} from '@grocery-pos/contracts';
import { useAuthStore } from '@/stores/auth';
import {
    click,
    field,
    flush,
    openDates,
    pick,
    selectField,
} from '@/testing/form-dom';
import type { ApiGet } from '@/testing/api-mock';
import Index from './Index.vue';
const api = vi.hoisted(() => ({ get: vi.fn<ApiGet>() }));
vi.mock('@/axios', () => ({ default: api }));
let app: App | undefined,
    pinia = createPinia();
const row = (): AuditLogView => ({
    _id: 'id',
    actor: { _id: '507f1f77bcf86cd799439011', name: 'Admin <script>' },
    action: AuditAction.USER_UPDATED,
    target: { model: 'User', id: '507f1f77bcf86cd799439012' },
    before: { name: 'old' },
    after: { name: '<img src=x onerror=alert(1)>' },
    approvedBy: null,
    ip: '127.0.0.1',
    userAgent: 'browser',
    createdAt: '2026-11-01T00:00:00Z',
});
beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    localStorage.clear();
    useAuthStore().user = {
        userId: '507f1f77bcf86cd799439011',
        username: 'admin',
        roles: [Role.Admin],
    };
    api.get.mockResolvedValue({ data: { data: [row()], totalItems: 21 } });
});
afterEach(() => {
    app?.unmount();
    app = undefined;
    disposePinia(pinia);
    document.body.innerHTML = '';
    vi.clearAllMocks();
});
async function mount() {
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(Index);
    app.use(pinia);
    app.mount(host);
    await flush();
}
function input(label: string, value: string) {
    const el = field(label);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
}
it('shows safe actor/action/detail diff text without treating stored strings as markup', async () => {
    await mount();
    expect(document.body.textContent).toContain('Admin <script>');
    expect(document.querySelector('script')).toBeNull();
    await click('View');
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('Not applicable');
});
it('pages and retries applied filters rather than unsearched edits', async () => {
    await mount();
    await openDates();
    input('From', '2026-11-01');
    await click('Search');
    await click('Next');
    expect(api.get).toHaveBeenLastCalledWith('/audit', {
        params: {
            from: '2026-11-01',
            to: undefined,
            username: undefined,
            action: undefined,
            page: 2,
            limit: 20,
        },
    });
    api.get.mockRejectedValueOnce(new Error('offline'));
    await click('Previous');
    input('From', '2026-12-01');
    await click('Retry');
    expect(
        api.get.mock.calls[api.get.mock.calls.length - 1]?.[1]?.params,
    ).toMatchObject({ from: '2026-11-01', page: 1 });
    await click('Clear Filters');
    expect(
        api.get.mock.calls[api.get.mock.calls.length - 1]?.[1]?.params,
    ).toMatchObject({ from: undefined, page: 1 });
});
it('a date preset searches page 1 once with the server today; an edit makes it Custom; Clear resets it (#215)', async () => {
    api.get.mockImplementation((url: string) =>
        Promise.resolve({
            data:
                url === '/settings/today'
                    ? { today: '2026-11-10', timezone: 'Asia/Manila' }
                    : { data: [row()], totalItems: 21 },
        }),
    );
    await mount();
    await openDates();
    const clear = () =>
        [...document.querySelectorAll('button')].find((b) =>
            b.textContent?.includes('Clear Filters'),
        )!;
    expect(clear().disabled).toBe(true);
    await click('Next');
    const audits = () => api.get.mock.calls.filter(([u]) => u === '/audit');
    const before = audits().length;

    await pick('Dates', 'This week');

    expect(audits()).toHaveLength(before + 1);
    expect(audits()[audits().length - 1]?.[1]?.params).toMatchObject({
        from: '2026-11-09',
        to: '2026-11-10',
        page: 1,
    });
    expect(clear().disabled).toBe(false);

    input('From', '2026-11-01');
    field('From').dispatchEvent(new Event('change'));
    await flush();
    expect(selectField('Dates').value).toBe('Custom');

    await click('Clear Filters');
    expect(audits()[audits().length - 1]?.[1]?.params).toMatchObject({
        from: undefined,
        to: undefined,
        page: 1,
    });
    expect(selectField('Dates').value).not.toBe('Custom');
    expect(clear().disabled).toBe(true);
});
it('validates date ordering and applies exact action selection', async () => {
    await mount();
    await openDates();
    input('Username', 'Cashier1');
    input('From', '2026-11-02');
    input('To', '2026-11-01');
    await click('Search');
    expect(api.get).toHaveBeenCalledTimes(1);
    input('To', '2026-11-03');
    const select = document.querySelector('select')!;
    select.value = AuditAction.USER_CREATED;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(
        api.get.mock.calls[api.get.mock.calls.length - 1]?.[1]?.params,
    ).toMatchObject({
        username: 'Cashier1',
        action: AuditAction.USER_CREATED,
    });
});
it('filters by a typed username on Enter, Search or clearing it, never an id (#143)', async () => {
    await mount();
    const box = field('Username');
    expect(box.maxLength).toBe(STRING_LIMITS.USERNAME);
    const hint = document.getElementById(box.getAttribute('aria-describedby')!);
    expect(hint?.textContent).toContain('Current username');
    input('Username', '  maria  ');
    expect(api.get).toHaveBeenCalledTimes(1);
    // Enter submits the FilterBar search form once.
    box.form!.requestSubmit();
    await flush();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.get).toHaveBeenLastCalledWith('/audit', {
        params: {
            username: 'maria',
            action: undefined,
            from: undefined,
            to: undefined,
            page: 1,
            limit: 20,
        },
    });
    expect(document.querySelector('[role=alert]')).toBeNull();
    input('Username', 'jose');
    await click('Next');
    expect(
        api.get.mock.calls[api.get.mock.calls.length - 1]?.[1]?.params,
    ).toMatchObject({ username: 'maria', page: 2 });
    field('Username').parentElement!.querySelector('button')!.click();
    await flush();
    expect(field('Username').value).toBe('');
    expect(
        api.get.mock.calls[api.get.mock.calls.length - 1]?.[1]?.params,
    ).toMatchObject({ username: undefined, page: 1 });
    input('Username', '   ');
    await click('Search');
    expect(
        api.get.mock.calls[api.get.mock.calls.length - 1]?.[1]?.params,
    ).toMatchObject({ username: undefined });
});
it('does not load audit data for USER_MANAGER', async () => {
    useAuthStore().user!.roles = [Role.UserManager];
    await mount();
    expect(api.get).not.toHaveBeenCalled();
});
it('ignores late request completion after a role change or unmount', async () => {
    let resolve: (value: { data: unknown }) => void = () => undefined;
    api.get.mockImplementationOnce(
        () =>
            new Promise((done) => {
                resolve = done;
            }),
    );
    await mount();
    useAuthStore().user!.roles = [Role.UserManager];
    await flush();
    resolve({ data: { data: [row()], totalItems: 1 } });
    await flush();
    expect(document.body.textContent).not.toContain('Admin <script>');
    app?.unmount();
    app = undefined;
    await flush();
});
it('shows empty and failed states and supports retry', async () => {
    api.get.mockRejectedValueOnce(new Error('network'));
    await mount();
    expect(document.querySelector('[role=alert]')).toBeTruthy();
    api.get.mockResolvedValueOnce({ data: { data: [], totalItems: 0 } });
    await click('Retry');
    expect(document.body.textContent).toContain('No matching audit events');
});
it('labels purchase-order actions and filters by them', async () => {
    api.get.mockResolvedValue({
        data: {
            data: [{ ...row(), action: AuditAction.PURCHASE_ORDER_RECEIVED }],
            totalItems: 1,
        },
    });
    await mount();
    expect(document.body.textContent).toContain('Purchase order received');
    const select = document.querySelector('select')!;
    const labels = [...select.options].map((o) => o.textContent?.trim());
    for (const label of [
        'Purchase order created',
        'Purchase order draft edited',
        'Purchase order sent',
        'Purchase order cancelled',
        'Purchase order received',
    ])
        expect(labels).toContain(label);
    select.value = AuditAction.PURCHASE_ORDER_CANCELLED;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(
        api.get.mock.calls[api.get.mock.calls.length - 1]?.[1]?.params,
    ).toMatchObject({ action: AuditAction.PURCHASE_ORDER_CANCELLED });
});
