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

async function loadStore() {
    vi.resetModules();
    const { useShiftStore } = await import('./shift');
    return useShiftStore();
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
});
