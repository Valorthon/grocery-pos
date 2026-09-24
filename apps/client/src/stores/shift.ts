import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import type {
    BillCounts,
    DrawerTransaction,
    ShiftRecord,
    ZReadReport,
} from '@/components/User/Sales/shift';

// v2: money is stored as integer centavos. A shift saved by an older build
// (pesos) is ignored rather than misread as 1/100th of its value.
const STORAGE_KEY = 'grocery_pos_active_shift_v2';
const LEGACY_STORAGE_KEY = 'grocery_pos_active_shift';

function loadActiveShift(): ShiftRecord | null {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    try {
        const parsed = JSON.parse(saved) as ShiftRecord;
        if (parsed && parsed.status === 'active') return parsed;
    } catch {
        return null;
    }
    return null;
}

export const useShiftStore = defineStore('shift', () => {
    const activeShift = ref<ShiftRecord | null>(loadActiveShift());

    const shiftInOpen = ref(false);
    const drawerAction = ref<'cash_in' | 'cash_drop' | null>(null);
    const shiftOutOpen = ref(false);
    const zRead = ref<ZReadReport | null>(null);

    const cashInTotal = computed(
        () =>
            activeShift.value?.drawerTransactions
                .filter((t) => t.type === 'cash_in')
                .reduce((sum, t) => sum + t.amount, 0) ?? 0,
    );

    const cashDropTotal = computed(
        () =>
            activeShift.value?.drawerTransactions
                .filter((t) => t.type === 'cash_drop')
                .reduce((sum, t) => sum + t.amount, 0) ?? 0,
    );

    const currentDrawerCash = computed(() => {
        if (!activeShift.value) return 0;
        return (
            activeShift.value.openingFloat +
            cashInTotal.value -
            cashDropTotal.value +
            activeShift.value.cashSales
        );
    });

    watch(
        activeShift,
        (shift) => {
            if (shift) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(shift));
            } else {
                localStorage.removeItem(STORAGE_KEY);
            }
        },
        { deep: true },
    );

    function startShift(
        cashier: string,
        terminal: string,
        billCounts: BillCounts,
        openingFloat: number,
    ) {
        activeShift.value = {
            id: `SHIFT-${Date.now()}`,
            cashier,
            terminal,
            openedAt: new Date().toISOString(),
            openingFloat,
            billCounts,
            drawerTransactions: [],
            cashSales: 0,
            status: 'active',
        };
        shiftInOpen.value = false;
    }

    function addDrawerTransaction(
        type: 'cash_in' | 'cash_drop',
        amount: number,
        reason: string,
    ) {
        if (!activeShift.value) return;
        const tx: DrawerTransaction = {
            id: `TX-${Date.now()}`,
            type,
            amount,
            reason,
            timestamp: new Date().toISOString(),
        };
        activeShift.value.drawerTransactions.push(tx);
    }

    function recordCashSale(cashAmount: number) {
        if (!activeShift.value || cashAmount <= 0) return;
        activeShift.value.cashSales += cashAmount;
    }

    function endShift(actualCash: number) {
        if (!activeShift.value) return;
        const expected = currentDrawerCash.value;
        const shift = activeShift.value;

        const report: ZReadReport = {
            shiftId: shift.id,
            cashier: shift.cashier,
            terminal: shift.terminal,
            openedAt: shift.openedAt,
            closedAt: new Date().toISOString(),
            openingFloat: shift.openingFloat,
            totalCashIn: cashInTotal.value,
            totalCashDrop: cashDropTotal.value,
            cashSales: shift.cashSales,
            expectedCash: expected,
            actualCash: actualCash,
            overShort: actualCash - expected,
        };

        activeShift.value = null;
        shiftOutOpen.value = false;
        zRead.value = report;
    }

    function reset() {
        activeShift.value = null;
        zRead.value = null;
        drawerAction.value = null;
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
        shiftInOpen,
        drawerAction,
        shiftOutOpen,
        zRead,
        cashInTotal,
        cashDropTotal,
        currentDrawerCash,
        startShift,
        addDrawerTransaction,
        recordCashSale,
        endShift,
        reset,
        goToRegister,
    };
});
