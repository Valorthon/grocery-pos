<template>
    <BaseModal
        v-model="open"
        title="Shift Out · Count Drawer"
        subtitle="Count all physical cash and coins currently inside the cash drawer"
        max-width="56rem"
        scrollable
    >
        <div
            class="flex items-center gap-1.5 text-slate-600 font-semibold text-[11px] mb-3"
        >
            <ShieldCheck class="w-3.5 h-3.5 text-slate-500" />
            <span>Enter the actual cash found in the drawer</span>
        </div>

        <BillCountInput v-model="billCounts" />

        <div class="mt-4 bg-slate-900 text-white rounded-xl p-4 space-y-3">
            <div class="flex items-center justify-between">
                <div>
                    <div
                        class="text-[10px] text-slate-400 font-bold uppercase tracking-wider"
                    >
                        Total Physical Counted Cash
                    </div>
                    <div
                        class="text-2xl font-mono font-black text-primary-300 mt-0.5"
                    >
                        {{ currency(actualCash) }}
                    </div>
                </div>
                <div class="text-right">
                    <span class="text-[11px] text-slate-400">Cashier:</span>
                    <div class="text-xs font-bold text-slate-200">
                        {{ shiftStore.activeShift?.cashier }}
                    </div>
                </div>
            </div>

            <div
                class="flex items-center justify-between p-2.5 bg-slate-800 rounded-lg text-xs"
            >
                <span class="text-slate-400">Variance:</span>
                <span class="font-mono font-bold" :class="varianceColor">
                    {{ varianceLabel }}
                </span>
            </div>
        </div>

        <template #footer>
            <BaseButton variant="outline" @click="open = false"
                >Cancel</BaseButton
            >
            <BaseButton class="flex-1" @click="confirm">
                Generate Z-Read Report
                <ArrowRight class="w-4 h-4" />
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowRight, ShieldCheck } from '@lucide/vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BillCountInput from './BillCountInput.vue';
import { ALL_DENOMINATIONS } from './shift';
import type { BillCounts } from './shift';
import { useShiftStore } from '@/stores/shift';
import { formatCurrency } from '@/utils/currency';

const shiftStore = useShiftStore();

const billCounts = ref<BillCounts>({});

const open = computed({
    get: () => shiftStore.shiftOutOpen,
    set: (val) => (shiftStore.shiftOutOpen = val),
});

const actualCash = computed(() =>
    ALL_DENOMINATIONS.reduce(
        (sum, d) => sum + (billCounts.value[d.id] ?? 0) * d.value,
        0,
    ),
);

const variance = computed(
    () => actualCash.value - shiftStore.currentDrawerCash,
);

const varianceLabel = computed(() => {
    const v = variance.value;
    if (Math.abs(v) < 0.005) return currency(0);
    return v > 0 ? `+${currency(v)}` : `-${currency(Math.abs(v))}`;
});

const varianceColor = computed(() => {
    const v = variance.value;
    if (Math.abs(v) < 0.005) return 'text-emerald-400';
    return v > 0 ? 'text-amber-400' : 'text-rose-400';
});

watch(
    () => shiftStore.shiftOutOpen,
    (val) => {
        if (val) billCounts.value = {};
    },
);

function currency(value: number): string {
    return formatCurrency(value);
}

function confirm() {
    shiftStore.endShift(actualCash.value);
}
</script>
