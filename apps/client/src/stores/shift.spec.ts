import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { AxiosError, AxiosHeaders } from 'axios';
import {
    type CurrentShiftView,
    DrawerMovementType,
    ErrorCode,
    ShiftStatus,
    type ZReadReport,
} from '@grocery-pos/contracts';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

const SHIFT: CurrentShiftView = {
    _id: 'shift1',
    status: ShiftStatus.OPEN,
    cashierName: 'ana',
    terminal: 'Lane #1',
    openedAt: '2026-09-25T00:00:00.000Z',
    openingFloat: 100_000,
    movements: [],
};

const REPORT = {
    shiftId: 'shift1',
    drawer: { expectedCash: 145_000, countedCash: 144_000, overShort: -1_000 },
} as unknown as ZReadReport;

function apiError(status: number, error: ErrorCode) {
    const config = { headers: new AxiosHeaders() };
    return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, {
        status,
        statusText: '',
        data: { statusCode: status, error, message: 'nope' },
        headers: {},
        config,
    });
}

let StaleResponseError: typeof import('./shift').StaleResponseError;

async function loadStore() {
    vi.resetModules();
    const mod = await import('./shift');
    StaleResponseError = mod.StaleResponseError;
    return mod.useShiftStore();
}

/** Every key the page wrote to localStorage. */
function storedKeys(): string[] {
    return Array.from({ length: localStorage.length }, (_, i) =>
        localStorage.key(i),
    ).filter((k): k is string => k !== null);
}

describe('shift store (server-backed, issue #2)', () => {
    beforeEach(() => {
        localStorage.clear();
        setActivePinia(createPinia());
        api.get.mockReset();
        api.post.mockReset();
    });

    it('removes the shift older builds kept in localStorage', async () => {
        localStorage.setItem('grocery_pos_active_shift', '{}');
        localStorage.setItem(
            'grocery_pos_active_shift_v2',
            JSON.stringify({ status: 'active', cashSales: 999 }),
        );

        const store = await loadStore();

        expect(storedKeys()).toEqual([]);
        expect(store.activeShift).toBeNull();
    });

    it('resumes the open shift from the server', async () => {
        api.get.mockResolvedValue({ data: { shift: SHIFT } });
        const store = await loadStore();

        await store.fetchCurrent();

        expect(api.get).toHaveBeenCalledWith('/shifts/current');
        expect(store.activeShift).toEqual(SHIFT);
        expect(store.loaded).toBe(true);
    });

    it('opens a shift by sending the counts only, and stores nothing locally', async () => {
        api.post.mockResolvedValue({ data: SHIFT });
        const store = await loadStore();
        store.shiftInOpen = true;

        await store.openShift({ '1000': 1 });

        expect(api.post).toHaveBeenCalledWith('/shifts', {
            counts: { '1000': 1 },
        });
        expect(store.activeShift).toEqual(SHIFT);
        expect(store.shiftInOpen).toBe(false);
        expect(storedKeys()).toEqual([]);
    });

    it('resumes the existing shift when one is already open', async () => {
        api.post.mockRejectedValue(apiError(409, ErrorCode.SHIFT_ALREADY_OPEN));
        api.get.mockResolvedValue({ data: { shift: SHIFT } });
        const store = await loadStore();

        await expect(store.openShift({ '1000': 1 })).resolves.toEqual(SHIFT);
    });

    it('records drawer movements on the server and shows its answer', async () => {
        const updated = {
            ...SHIFT,
            movements: [
                {
                    type: DrawerMovementType.CASH_DROP,
                    amount: 1_000_000,
                    reason: 'safe',
                    at: '2026-09-25T01:00:00.000Z',
                    byName: 'ana',
                    sale: null,
                },
            ],
        };
        api.post.mockResolvedValue({ data: updated });
        const store = await loadStore();

        // Larger than any float: the client does not check drops.
        await store.recordDrawer(
            DrawerMovementType.CASH_DROP,
            1_000_000,
            'safe',
        );

        expect(api.post).toHaveBeenCalledWith('/shifts/current/drawer', {
            type: DrawerMovementType.CASH_DROP,
            amount: 1_000_000,
            reason: 'safe',
        });
        expect(store.activeShift).toEqual(updated);
    });

    it('drops the shift when the server says it is no longer open', async () => {
        api.get.mockResolvedValue({ data: { shift: SHIFT } });
        api.post.mockRejectedValue(apiError(409, ErrorCode.SHIFT_NOT_OPEN));
        const store = await loadStore();
        await store.fetchCurrent();

        await expect(
            store.recordDrawer(DrawerMovementType.CASH_IN, 100, 'x'),
        ).rejects.toThrow();

        expect(store.activeShift).toBeNull();
        expect(store.loaded).toBe(true);
    });

    it('closes with the counts and shows the Z-read the server returns', async () => {
        api.get.mockResolvedValue({ data: { shift: SHIFT } });
        api.post.mockResolvedValue({ data: REPORT });
        const store = await loadStore();
        await store.fetchCurrent();
        store.shiftOutOpen = true;

        await store.closeShift({ '500': 2 });

        expect(api.post).toHaveBeenCalledWith('/shifts/current/close', {
            counts: { '500': 2 },
        });
        expect(store.zRead).toEqual(REPORT);
        expect(store.activeShift).toBeNull();
        expect(store.shiftOutOpen).toBe(false);
        expect(storedKeys()).toEqual([]);
    });

    it('reopens the last closed shift’s Z-read', async () => {
        api.get.mockResolvedValue({ data: { report: REPORT } });
        const store = await loadStore();

        await expect(store.showLastReport()).resolves.toBe(true);

        expect(api.get).toHaveBeenCalledWith('/shifts/last-closed');
        expect(store.zRead).toEqual(REPORT);
    });

    it('says when there is no closed shift yet', async () => {
        api.get.mockResolvedValue({ data: { report: null } });
        const store = await loadStore();

        await expect(store.showLastReport()).resolves.toBe(false);
        expect(store.zRead).toBeNull();
    });

    it('forgets everything on reset, and ignores a response that lands after it', async () => {
        let answer!: (value: unknown) => void;
        api.get.mockReturnValue(new Promise((resolve) => (answer = resolve)));
        const store = await loadStore();

        const pending = store.fetchCurrent();
        store.reset();
        answer({ data: { shift: SHIFT } });
        await pending;

        expect(store.activeShift).toBeNull();
        expect(store.loaded).toBe(false);
        expect(store.zRead).toBeNull();
    });

    describe('a response that lands after logout is dropped', () => {
        /** A request held open until `answer` is called. */
        function held(method: 'get' | 'post') {
            let answer!: (value: unknown) => void;
            let fail!: (error: unknown) => void;
            api[method].mockReturnValue(
                new Promise((resolve, reject) => {
                    answer = resolve;
                    fail = reject;
                }),
            );
            return {
                answer: (v: unknown) => answer(v),
                fail: (e: unknown) => fail(e),
            };
        }

        it('never shows the previous cashier’s last Z-read', async () => {
            const req = held('get');
            const store = await loadStore();

            const pending = store.showLastReport();
            store.reset();
            req.answer({ data: { report: REPORT } });

            await expect(pending).resolves.toBe(false);
            expect(store.zRead).toBeNull();
        });

        it('never shows the Z-read of a close that finished after logout', async () => {
            const req = held('post');
            const store = await loadStore();

            const pending = store.closeShift({ '500': 2 });
            store.reset();
            req.answer({ data: REPORT });

            await expect(pending).rejects.toBeInstanceOf(StaleResponseError);
            expect(store.zRead).toBeNull();
            expect(store.activeShift).toBeNull();
        });

        it('does not restore a shift opened just before logout', async () => {
            const req = held('post');
            const store = await loadStore();

            const pending = store.openShift({ '1000': 1 });
            store.reset();
            req.answer({ data: SHIFT });

            await expect(pending).rejects.toBeInstanceOf(StaleResponseError);
            expect(store.activeShift).toBeNull();
            expect(store.loaded).toBe(false);
        });

        it('does not restore the shift from a drawer movement answered after logout', async () => {
            const req = held('post');
            const store = await loadStore();

            const pending = store.recordDrawer(
                DrawerMovementType.CASH_IN,
                100,
                'x',
            );
            store.reset();
            req.answer({ data: SHIFT });

            await expect(pending).rejects.toBeInstanceOf(StaleResponseError);
            expect(store.activeShift).toBeNull();
        });

        it('does not mark the store loaded from a failure answered after logout', async () => {
            const req = held('post');
            const store = await loadStore();

            const pending = store.recordDrawer(
                DrawerMovementType.CASH_IN,
                100,
                'x',
            );
            store.reset();
            req.fail(apiError(409, ErrorCode.SHIFT_NOT_OPEN));

            await expect(pending).rejects.toBeInstanceOf(StaleResponseError);
            expect(store.loaded).toBe(false);
        });
    });
});
