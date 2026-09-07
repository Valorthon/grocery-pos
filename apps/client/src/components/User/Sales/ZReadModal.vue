<template>
    <BaseModal v-model="open" max-width="28rem" scrollable>
        <template #header>
            <div class="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 class="w-4 h-4 text-emerald-600" />
                <span class="text-xs font-bold">Official Z-Read Report</span>
            </div>
        </template>

        <div
            class="p-4 sm:p-5 overflow-y-auto bg-slate-100 font-mono text-xs text-slate-900"
        >
            <div
                v-if="report"
                class="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-4"
            >
                <div
                    class="text-center border-b border-dashed border-slate-300 pb-3"
                >
                    <div
                        class="font-sans font-black text-sm uppercase tracking-wider text-slate-900"
                    >
                        Grocery POS Store
                    </div>
                    <div class="text-[11px] text-slate-500 font-sans mt-0.5">
                        Terminal {{ report.terminal }} • Z-READING
                    </div>
                    <div class="text-[10px] text-slate-400 mt-1">
                        {{ formattedStart }} — {{ formattedEnd }}
                    </div>
                    <div class="text-[11px] font-bold text-slate-700 mt-1">
                        Cashier: {{ report.cashier }}
                    </div>
                </div>

                <div
                    class="space-y-1.5 border-b border-dashed border-slate-300 pb-3 text-[11px]"
                >
                    <div
                        class="font-sans font-bold text-slate-800 uppercase text-[10px]"
                    >
                        Drawer Movements
                    </div>
                    <div class="flex justify-between">
                        <span class="text-slate-600">Opening Float:</span>
                        <span class="font-bold">{{
                            currency(report.openingFloat)
                        }}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-slate-600"
                            >(+) Cash In (Change):</span
                        >
                        <span class="font-bold">{{
                            currency(report.totalCashIn)
                        }}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-slate-600"
                            >(-) Cash Drop (Safe):</span
                        >
                        <span class="font-bold">{{
                            currency(report.totalCashDrop)
                        }}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-slate-600">(+) Cash Sales:</span>
                        <span class="font-bold text-emerald-700">{{
                            currency(report.cashSales)
                        }}</span>
                    </div>
                </div>

                <div
                    class="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5 text-[11px]"
                >
                    <div class="flex justify-between font-bold text-slate-900">
                        <span>Physical Cash Counted:</span>
                        <span class="text-primary-600">{{
                            currency(report.actualCash)
                        }}</span>
                    </div>
                    <div
                        class="flex justify-between font-black pt-1 border-t border-slate-300"
                        :class="
                            Math.abs(report.overShort) < 0.01
                                ? 'text-emerald-700'
                                : report.overShort > 0
                                  ? 'text-amber-700'
                                  : 'text-rose-700'
                        "
                    >
                        <span>
                            VARIANCE ({{
                                Math.abs(report.overShort) < 0.01
                                    ? 'EXACT'
                                    : report.overShort > 0
                                      ? 'OVER'
                                      : 'SHORT'
                            }}):
                        </span>
                        <span>
                            {{
                                report.overShort > 0
                                    ? `+${currency(report.overShort)}`
                                    : report.overShort < 0
                                      ? `-${currency(Math.abs(report.overShort))}`
                                      : currency(0)
                            }}
                        </span>
                    </div>
                </div>

                <div
                    class="text-center text-[10px] text-slate-400 font-sans pt-1"
                >
                    --- END OF Z-READ REPORT ---
                </div>
            </div>
        </div>

        <template #footer>
            <BaseButton variant="outline" class="flex-1" @click="print">
                <Printer class="w-3.5 h-3.5" />
                Print
            </BaseButton>
            <BaseButton class="flex-1" @click="closeShift">
                Close Shift & Return to Dashboard
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CheckCircle2, Printer } from '@lucide/vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useShiftStore } from '@/stores/shift';
import { formatCurrency } from '@/utils/currency';

const shiftStore = useShiftStore();

const report = computed(() => shiftStore.zRead);

const open = computed({
    get: () => shiftStore.zRead !== null,
    set: (val) => {
        if (!val) shiftStore.zRead = null;
    },
});

const formattedStart = computed(() =>
    report.value ? formatDate(report.value.openedAt) : '',
);
const formattedEnd = computed(() =>
    report.value ? formatDate(report.value.closedAt) : '',
);

function formatDate(iso: string): string {
    return new Date(iso).toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

function currency(value: number): string {
    return formatCurrency(value);
}

function print() {
    window.print();
}

async function closeShift() {
    shiftStore.reset();
    const { default: router } = await import('@/router');
    router.push({ name: 'SellerDashboard' });
}
</script>
