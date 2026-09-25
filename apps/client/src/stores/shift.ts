import { ref } from 'vue';
import { defineStore } from 'pinia';
import { isAxiosError } from 'axios';
import api from '@/axios';
import {
    type BillCounts,
    type CashierDrawerMovement,
    type CurrentShiftView,
    ErrorCode,
    type ZReadReport,
} from '@grocery-pos/contracts';

/**
 * Where older builds kept the whole shift in the browser (issue #2). The
 * shift now lives on the server; these are removed once, on load, so a
 * stale local shift can never be read again.
 */
export const LEGACY_SHIFT_STORAGE_KEYS = [
    'grocery_pos_active_shift',
    'grocery_pos_active_shift_v2',
];

function clearLegacyShiftStorage(): void {
    try {
        for (const key of LEGACY_SHIFT_STORAGE_KEYS) {
            localStorage.removeItem(key);
        }
    } catch {
        // Storage unavailable: nothing to clean up.
    }
}

/**
 * A response that arrived after the store was reset (logout): it belongs
 * to the previous user and was dropped.
 */
export class StaleResponseError extends Error {
    constructor() {
        super('Signed out before the server answered');
        this.name = 'StaleResponseError';
    }
}

/** The API's `ErrorCode` on a failed request, if any. */
export function apiErrorCode(error: unknown): string | undefined {
    if (!isAxiosError(error)) return undefined;
    const data = error.response?.data as { error?: unknown } | undefined;
    return typeof data?.error === 'string' ? data.error : undefined;
}

/** The API's message on a failed request, or `fallback`. */
export function apiErrorMessage(error: unknown, fallback: string): string {
    if (isAxiosError(error)) {
        const data = error.response?.data as { message?: unknown } | undefined;
        if (typeof data?.message === 'string' && data.message) {
            return data.message;
        }
    }
    return fallback;
}

/**
 * The cashier's shift, as the server holds it (issue #2). Nothing here is
 * computed or stored locally: every figure comes from an API response.
 * While the shift is open the server is blind to the cashier (no expected
 * cash or variance); the Z-read arrives only after the count is submitted.
 */
export const useShiftStore = defineStore('shift', () => {
    clearLegacyShiftStorage();

    /** The caller's open shift, or null. */
    const activeShift = ref<CurrentShiftView | null>(null);
    /** True once the server has answered whether a shift is open. */
    const loaded = ref(false);

    const shiftInOpen = ref(false);
    const drawerAction = ref<CashierDrawerMovement | null>(null);
    const shiftOutOpen = ref(false);
    /** The Z-read on screen. Closing the modal only hides it. */
    const zRead = ref<ZReadReport | null>(null);

    // Bumped by reset(): a response to a request made before logout must
    // not repopulate the store for the next user. Every request captures it
    // and drops its result if it changed.
    let generation = 0;

    function setShift(shift: CurrentShiftView | null) {
        activeShift.value = shift;
        loaded.value = true;
    }

    /** Reads the caller's open shift from the server. */
    async function fetchCurrent(): Promise<CurrentShiftView | null> {
        const gen = generation;
        const res = await api.get<{ shift: CurrentShiftView | null }>(
            '/shifts/current',
        );
        if (gen === generation) setShift(res.data.shift);
        return activeShift.value;
    }

    /**
     * The shift was closed elsewhere (an ADMIN force-closed it) or never
     * opened: drop it, so the register asks for a new one.
     */
    function shiftClosedElsewhere() {
        setShift(null);
        drawerAction.value = null;
        shiftOutOpen.value = false;
    }

    /** Opens a shift with the counted float. The server adds it up. */
    async function openShift(counts: BillCounts): Promise<CurrentShiftView> {
        const gen = generation;
        try {
            const res = await api.post<CurrentShiftView>('/shifts', {
                counts,
            });
            if (gen !== generation) throw new StaleResponseError();
            setShift(res.data);
        } catch (error) {
            if (gen !== generation) throw new StaleResponseError();
            // Already open (another tab, or a lost response): resume it.
            if (apiErrorCode(error) !== ErrorCode.SHIFT_ALREADY_OPEN) {
                throw error;
            }
            if (!(await fetchCurrent())) throw error;
        }
        shiftInOpen.value = false;
        return activeShift.value!;
    }

    /** Records a cash in or cash drop. Drops are not checked here. */
    async function recordDrawer(
        type: CashierDrawerMovement,
        amount: number,
        reason: string,
    ): Promise<void> {
        const gen = generation;
        try {
            const res = await api.post<CurrentShiftView>(
                '/shifts/current/drawer',
                { type, amount, reason },
            );
            if (gen !== generation) throw new StaleResponseError();
            setShift(res.data);
        } catch (error) {
            if (gen !== generation) throw new StaleResponseError();
            if (apiErrorCode(error) === ErrorCode.SHIFT_NOT_OPEN) {
                shiftClosedElsewhere();
            }
            throw error;
        }
    }

    /**
     * Submits the blind closing count. The server computes expected cash
     * and returns the Z-read it stored, which is then shown.
     */
    async function closeShift(counts: BillCounts): Promise<ZReadReport> {
        const gen = generation;
        let report: ZReadReport;
        try {
            report = (
                await api.post<ZReadReport>('/shifts/current/close', {
                    counts,
                })
            ).data;
        } catch (error) {
            if (gen !== generation) throw new StaleResponseError();
            if (apiErrorCode(error) === ErrorCode.SHIFT_NOT_OPEN) {
                shiftClosedElsewhere();
            }
            throw error;
        }
        // Signed out meanwhile: this report is not for whoever is here now.
        if (gen !== generation) throw new StaleResponseError();
        setShift(null);
        shiftOutOpen.value = false;
        zRead.value = report;
        return report;
    }

    /**
     * Shows the caller's most recently closed shift's Z-read. False when
     * there is none yet.
     */
    async function showLastReport(): Promise<boolean> {
        const gen = generation;
        const res = await api.get<{ report: ZReadReport | null }>(
            '/shifts/last-closed',
        );
        // Signed out meanwhile: never show one cashier's report to the next.
        if (gen !== generation) return false;
        zRead.value = res.data.report;
        return res.data.report !== null;
    }

    /** Forgets everything, e.g. on logout. The server shift stays open. */
    function reset() {
        generation++;
        activeShift.value = null;
        loaded.value = false;
        shiftInOpen.value = false;
        drawerAction.value = null;
        shiftOutOpen.value = false;
        zRead.value = null;
    }

    async function goToRegister() {
        if (activeShift.value) {
            const { default: router } = await import('@/router');
            router.push({ name: 'Sell' });
            return;
        }
        shiftInOpen.value = true;
    }

    return {
        activeShift,
        loaded,
        shiftInOpen,
        drawerAction,
        shiftOutOpen,
        zRead,
        fetchCurrent,
        openShift,
        recordDrawer,
        closeShift,
        showLastReport,
        shiftClosedElsewhere,
        reset,
        goToRegister,
    };
});
