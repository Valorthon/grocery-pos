import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import {
    ErrorCode,
    OverrideAction,
    Role,
    StockCountStatus,
    UnitOfMeasure,
    type StockCountView,
} from '@grocery-pos/contracts';
import Index from './Index.vue';
import { useAuthStore } from '@/stores/auth';
import { Color, useUIStore } from '@/stores/ui';
import { AxiosError, AxiosHeaders } from 'axios';
import { field, flush, type } from '@/testing/form-dom';
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
const routing = vi.hoisted(() => ({ guard: vi.fn() }));
vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal<typeof import('vue-router')>()),
    onBeforeRouteLeave: routing.guard,
    useRouter: () => ({ currentRoute: { value: { query: {} } } }),
}));
const id = '507f1f77bcf86cd799439011',
    product = '507f1f77bcf86cd799439012',
    line = '507f1f77bcf86cd799439013';
function fixture(): StockCountView {
    return {
        _id: id,
        scope: 'all',
        status: StockCountStatus.OPEN,
        version: 0,
        createdBy: { _id: 'owner', name: 'counter' },
        createdAt: '2026-11-05T00:00:00.000Z',
        updatedAt: '2026-11-05T00:00:00.000Z',
        lines: [
            {
                _id: line,
                product,
                name: 'Rice',
                EAN: '12345678',
                unit: UnitOfMeasure.KG,
                tracksExpiry: false,
                expectedQty: 1000,
                currentQty: 800,
            },
        ],
    };
}
function conflict(message: string) {
    return new AxiosError(message, '409', undefined, undefined, {
        status: 409,
        statusText: 'Conflict',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: {
            statusCode: 409,
            error: ErrorCode.CONFLICT,
            message,
            timestamp: 'now',
            path: '/stock-counts',
            requestId: 'r',
        },
    });
}
let app: App | undefined, count: StockCountView;
async function mount() {
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(Index);
    app.mount(host);
    await flush();
}
async function exact(text: string) {
    const button = [...document.querySelectorAll('button')]
        .reverse()
        .find((b) => b.textContent?.trim() === text);
    if (!button) throw new Error(text);
    button.click();
    await flush();
}
async function enter(value: string) {
    const input = document.querySelector<HTMLInputElement>(`#count-${line}`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await flush();
}
function deferred() {
    let resolve!: (v: unknown) => void, reject!: (v: unknown) => void;
    const promise = new Promise((a, b) => {
        resolve = a;
        reject = b;
    });
    return { promise, resolve, reject };
}
beforeEach(() => {
    vi.clearAllMocks();
    document.cookie = 'dummy=1; path=/';
    setActivePinia(createPinia());
    useAuthStore().user = {
        userId: 'owner',
        username: 'counter',
        roles: [Role.Adjuster],
    };
    count = fixture();
    api.get.mockImplementation(async (url: string) => {
        if (url === '/categories')
            return {
                data: {
                    data: [{ _id: 'category', name: 'Food' }],
                    totalItems: 1,
                },
            };
        if (url === '/stock-counts')
            return { data: { data: [structuredClone(count)], totalItems: 1 } };
        if (url.startsWith('/products/')) return { data: { _id: product } };
        return { data: structuredClone(count) };
    });
    api.patch.mockImplementation(
        async (
            _url: string,
            body: {
                version: number;
                lines: { line: string; countedQty: number }[];
            },
        ) => {
            for (const patch of body.lines) {
                const row = count.lines.find((l) => l._id === patch.line)!;
                row.countedQty = patch.countedQty;
                row.variance = patch.countedQty - row.expectedQty;
            }
            count.version++;
            return { data: structuredClone(count) };
        },
    );
    api.post.mockImplementation(async (url: string) => {
        if (url === '/auth/override')
            return {
                data: {
                    token: 'grant',
                    expiresAt: 'later',
                    approver: { _id: 'admin', name: 'Admin' },
                },
            };
        if (url.endsWith('/submit')) {
            count.status = StockCountStatus.SUBMITTED;
            count.version++;
        }
        if (url.endsWith('/cancel')) {
            count.status = StockCountStatus.CANCELLED;
            count.version++;
        }
        if (url.endsWith('/approve')) {
            count.status = StockCountStatus.APPROVED;
            count.version++;
            count.adjustment = 'adjustment';
        }
        return { data: structuredClone(count) };
    });
});
afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = '';
    document.cookie = 'dummy=; max-age=0; path=/';
});
describe('physical stock count workflow', () => {
    it('loads sessions, shows opening reference/caveat, starts and resumes a scoped count', async () => {
        await mount();
        expect(document.body.textContent).toContain('opening reference');
        await exact('Start count');
        expect(api.post).toHaveBeenCalledWith('/stock-counts', {
            scope: 'all',
        });
        expect(document.body.textContent).toContain('Nov 5, 2026');
        expect(document.body.textContent).not.toContain('2026-11-05T');
        expect(document.body.textContent).toContain('1.000 kg');
        expect(document.body.textContent).toContain('0.800 kg');
        await exact('Back to counts');
        await exact('Open count');
        expect(api.get).toHaveBeenCalledWith(`/stock-counts/${id}`);
    });
    it('saves explicit zero and measured quantities without overwriting opening expectations', async () => {
        await mount();
        await exact('Open count');
        await enter('0.450');
        await exact('Save progress');
        expect(api.patch).toHaveBeenCalledWith(`/stock-counts/${id}`, {
            version: 0,
            lines: [{ line, countedQty: 450 }],
        });
        expect(document.body.textContent).toContain('-0.550 kg');
        await enter('0');
        await exact('Save progress');
        expect(count.lines[0].countedQty).toBe(0);
        expect(count.lines[0].expectedQty).toBe(1000);
    });
    it.each(['-1', '1.0001', 'abc', '9007199254740992'])(
        'rejects invalid measured entry %s without request',
        async (value) => {
            await mount();
            await exact('Open count');
            await enter(value);
            await exact('Save progress');
            expect(api.patch).not.toHaveBeenCalled();
            expect(document.body.textContent).toContain('valid nonnegative');
        },
    );
    it('keeps blanks uncounted, refuses clearing saved progress, and avoids empty save requests', async () => {
        await mount();
        await exact('Open count');
        await exact('Save progress');
        expect(api.patch).not.toHaveBeenCalled();
        await enter('0');
        await exact('Save progress');
        api.patch.mockClear();
        await enter('');
        await exact('Save progress');
        expect(document.body.textContent).toContain('cannot be cleared');
        expect(api.patch).not.toHaveBeenCalled();
    });
    it('saves before submitting, displays movement-adjusted projection and uses count/version manager context', async () => {
        await mount();
        await exact('Open count');
        await enter('0.900');
        await exact('Submit for approval');
        await exact('Submit count');
        expect(count.status).toBe(StockCountStatus.SUBMITTED);
        expect(document.body.textContent).toContain('0.700 kg');
        await exact('Manager approval and post');
        await type('Manager username', 'boss');
        await type('6-digit manager PIN', '012345');
        await exact('Approve action');
        await vi.waitFor(() =>
            expect(api.post).toHaveBeenCalledWith(
                `/stock-counts/${id}/approve`,
                { version: count.version - 1 },
                { headers: { 'X-Manager-Approval': 'grant' } },
            ),
        );
        expect(api.post).toHaveBeenCalledWith(
            '/auth/override',
            expect.objectContaining({
                action: OverrideAction.STOCK_COUNT,
                context: { stockCount: { countId: id, version: 2 } },
            }),
        );
        expect(document.body.textContent).toContain('APPROVED');
    });
    it('cancels only after confirmation and leaves stock untouched before the confirmed call', async () => {
        await mount();
        await exact('Open count');
        await exact('Cancel count');
        expect(api.post).not.toHaveBeenCalled();
        await exact('Cancel');
        await vi.waitFor(() =>
            expect(document.querySelector('[role=dialog]')).toBeNull(),
        );
        expect(api.post).not.toHaveBeenCalled();
        await exact('Cancel count');
        await exact('Cancel count');
        expect(count.status).toBe(StockCountStatus.CANCELLED);
    });
    it('retains unsaved entries and shows save failure; blocks duplicate save and navigation while pending', async () => {
        const pending = deferred();
        api.patch.mockReturnValueOnce(pending.promise);
        await mount();
        await exact('Open count');
        await enter('0.9');
        await exact('Save progress');
        await exact('Save progress');
        expect(api.patch).toHaveBeenCalledTimes(1);
        const guard = routing.guard.mock.calls[
            routing.guard.mock.calls.length - 1
        ]?.[0] as () => Promise<boolean>;
        await expect(guard()).resolves.toBe(false);
        pending.reject(new Error('network'));
        await flush();
        expect(useUIStore().toasts).toEqual([
            expect.objectContaining({
                color: Color.ERROR,
                lines: [expect.stringContaining('Stock count could not')],
            }),
        ]);
        expect(document.body.textContent).not.toContain('Reload');
        expect(
            document.querySelector<HTMLInputElement>(`#count-${line}`)?.value,
        ).toBe('0.9');
    });
    it('ignores late loads after account change or unmount', async () => {
        const pending = deferred();
        api.get.mockImplementation((url: string) =>
            url === '/stock-counts'
                ? pending.promise
                : Promise.resolve({ data: { data: [], totalItems: 0 } }),
        );
        await mount();
        useAuthStore().user = {
            userId: 'other',
            username: 'other',
            roles: [Role.Adjuster],
        };
        await flush();
        pending.resolve({ data: { data: [count], totalItems: 1 } });
        await flush();
        expect(document.body.textContent).not.toContain('Open count');
    });
    it('preserves unsaved edits when Back is cancelled and warns on browser unload', async () => {
        await mount();
        await exact('Open count');
        await enter('0.5');
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        await exact('Back to counts');
        await exact('Stay');
        expect(document.querySelector(`#count-${line}`)).not.toBeNull();
        await exact('Back to counts');
        await exact('Discard unsaved entries');
        expect(document.querySelector(`#count-${line}`)).toBeNull();
    });
    it('focuses a matching barcode and reports a barcode outside the scope', async () => {
        await mount();
        await exact('Open count');
        await type('Scan barcode', '12345678');
        field('Scan barcode').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        );
        await flush();
        expect(document.activeElement?.id).toBe(`count-${line}`);
        await type('Scan barcode', 'missing');
        field('Scan barcode').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        );
        await flush();
        expect(document.body.textContent).toContain('not in this count');
    });
    it('colours the variance by sign in a right-aligned numeric column (#169)', async () => {
        await mount();
        await exact('Open count');
        const variance = () =>
            document.querySelector('[data-testid="count-variance"]')!;
        expect(variance().textContent).toBe('Not counted');
        expect(variance().className).toBe('text-muted');
        await enter('0.450');
        expect(variance().className.split(' ')).toContain('text-danger-fg');
        await enter('1.200');
        expect(variance().className.split(' ')).toContain('text-success-fg');
        await enter('1');
        expect(variance().className).toBe('text-muted');
        expect(variance().closest('td')!.className.split(/\s+/)).toEqual(
            expect.arrayContaining(['text-right', 'num']),
        );
    });
    it('creates a picked scope from server-resolved barcodes and category scope with explicit reference', async () => {
        await mount();
        const select = document.querySelector('select')!;
        select.value = 'products';
        select.dispatchEvent(new Event('change'));
        await flush();
        await type('Barcodes', '12345678 12345678');
        await exact('Start count');
        expect(api.post).toHaveBeenCalledWith('/stock-counts', {
            scope: 'products',
            products: [product],
        });
        await exact('Back to counts');
        // The list view re-renders its form: query the new scope select.
        const scopeSelect = document.querySelector('select')!;
        scopeSelect.value = 'category';
        scopeSelect.dispatchEvent(new Event('change'));
        await flush();
        const category = document.querySelectorAll('select')[1];
        category.value = 'category';
        category.dispatchEvent(new Event('change'));
        await flush();
        await exact('Start count');
        expect(api.post).toHaveBeenCalledWith('/stock-counts', {
            scope: 'category',
            category: 'category',
        });
    });
    it('shows list loading errors with retry and paginates sessions', async () => {
        let failed = false;
        api.get.mockImplementation((url: string) => {
            if (url === '/stock-counts' && !failed) {
                failed = true;
                return Promise.reject(new Error('network'));
            }
            return Promise.resolve({
                data: {
                    data: url === '/stock-counts' ? [count] : [],
                    totalItems: url === '/stock-counts' ? 1 : 0,
                },
            });
        });
        await mount();
        expect(document.querySelector('[role=alert]')).not.toBeNull();
        await exact('Reload');
    });
    it('validates category and picked scope before sending a snapshot request', async () => {
        await mount();
        const scope = document.querySelector('select')!;
        scope.value = 'category';
        scope.dispatchEvent(new Event('change'));
        await flush();
        await exact('Start count');
        expect(api.post).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('Choose a category');
        scope.value = 'products';
        scope.dispatchEvent(new Event('change'));
        await flush();
        await exact('Start count');
        expect(api.post).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('distinct barcodes');
    });
    it('loads the next page without changing the saved count list until the response', async () => {
        api.get.mockImplementation((url: string) =>
            url === '/stock-counts'
                ? Promise.resolve({ data: { data: [count], totalItems: 40 } })
                : Promise.resolve({ data: { data: [], totalItems: 0 } }),
        );
        await mount();
        await exact('Next');
        expect(api.get).toHaveBeenCalledWith('/stock-counts', {
            params: { page: 2, limit: 20 },
        });
        await exact('Previous');
        expect(api.get).toHaveBeenCalledWith('/stock-counts', {
            params: { page: 1, limit: 20 },
        });
    });
    it('reloads a stale detail only after confirming unsaved edits, not merely the background list', async () => {
        await mount();
        await exact('Open count');
        await enter('0.5');
        api.patch.mockRejectedValueOnce(
            conflict('Stock count changed. Reload it before continuing.'),
        );
        await exact('Save progress');
        await exact('Reload');
        await exact('Stay');
        expect(
            document.querySelector<HTMLInputElement>(`#count-${line}`)?.value,
        ).toBe('0.5');
        await vi.waitFor(() =>
            expect(document.querySelector('[role=dialog]')).toBeNull(),
        );
        count.version = 5;
        count.lines[0].countedQty = 800;
        await exact('Reload');
        await exact('Discard unsaved entries');
        expect(api.get).toHaveBeenLastCalledWith(`/stock-counts/${id}`);
        expect(
            document.querySelector<HTMLInputElement>(`#count-${line}`)?.value,
        ).toBe('0.800');
    });
    it('shows the opening time in the store timezone', async () => {
        count.createdAt = '2026-11-05T16:30:00.000Z';
        await mount();
        expect(document.body.textContent).toContain('Nov 6, 2026');
        expect(document.body.textContent).toContain('12:30');
        await exact('Open count');
        expect(document.body.textContent).toMatch(/Reference:\s*Nov 6, 2026/);
    });
    it('refuses submitting uncounted lines inline without a confirm or request', async () => {
        await mount();
        await exact('Open count');
        await exact('Submit for approval');
        expect(document.querySelector('[role=dialog]')).toBeNull();
        expect(api.post).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('Uncounted: Rice');
        expect(document.body.textContent).not.toContain('Reload');
        expect(document.activeElement?.id).toBe(`count-${line}`);
    });
    it('shows a server refusal of submit as an error toast, not a load error', async () => {
        await mount();
        await exact('Open count');
        await enter('1');
        api.post.mockRejectedValueOnce(new Error('refused'));
        await exact('Submit for approval');
        await exact('Submit count');
        expect(useUIStore().toasts[0]?.color).toBe(Color.ERROR);
        expect(document.body.textContent).not.toContain('Reload');
    });
    it('confirms a saved count with a success toast', async () => {
        await mount();
        await exact('Open count');
        await enter('0.5');
        await exact('Save progress');
        expect(useUIStore().toasts).toEqual([
            expect.objectContaining({
                color: Color.SUCCESS,
                lines: ['Count progress saved.'],
            }),
        ]);
    });
    it('words the manager approval for a stock count, not the register', async () => {
        count.status = StockCountStatus.SUBMITTED;
        count.lines[0].countedQty = 900;
        await mount();
        await exact('Open count');
        await exact('Manager approval and post');
        expect(document.body.textContent).toContain(
            'applies to this count only',
        );
        expect(document.body.textContent).not.toContain('cashier');
    });
    it('names each uncounted batch of a tracked product by batch or expiry', async () => {
        const base = count.lines[0];
        count.lines = [
            { ...base, tracksExpiry: true, batch: 'b1', batchNo: 'L7' },
            {
                ...base,
                _id: '507f1f77bcf86cd799439014',
                tracksExpiry: true,
                batch: 'b2',
                expiryDate: '2026-12-01',
            },
        ];
        await mount();
        await exact('Open count');
        await exact('Submit for approval');
        expect(document.body.textContent).toContain(
            'Uncounted: Rice (batch L7), Rice (expires 2026-12-01).',
        );
    });
    it('does not claim a save when nothing changed', async () => {
        await mount();
        await exact('Open count');
        await exact('Save progress');
        expect(api.patch).not.toHaveBeenCalled();
        expect(useUIStore().toasts).toEqual([]);
    });
});
