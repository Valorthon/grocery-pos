<template>
    <BaseModal
        v-model="open"
        title="Shift In · Opening Float"
        :subtitle="`Log starting cash in drawer for ${terminal} (${cashierName})`"
        max-width="56rem"
        scrollable
    >
        <BillCountInput v-model="billCounts" />

        <div
            class="mt-4 bg-slate-900 text-white rounded-xl p-3.5 flex items-center justify-between"
        >
            <div>
                <div
                    class="text-[10px] uppercase font-bold text-slate-400 tracking-wider"
                >
                    Total Opening Float ({{ totalPieces }} pieces)
                </div>
                <div class="text-2xl font-black font-mono text-primary-300">
                    {{ currency(total) }}
                </div>
            </div>
            <ShieldCheck class="w-5 h-5 text-primary-300" />
        </div>

        <template #footer>
            <BaseButton variant="outline" @click="open = false"
                >Cancel</BaseButton
            >
            <BaseButton class="flex-1" @click="confirm">
                Open Register
                <ArrowRight class="w-4 h-4" />
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowRight, ShieldCheck } from '@lucide/vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BillCountInput from './BillCountInput.vue';
import { ALL_DENOMINATIONS } from './shift';
import type { BillCounts } from './shift';
import { useShiftStore } from '@/stores/shift';
import { useAuthStore } from '@/stores/auth';
import { formatCurrency } from '@/utils/currency';

const shiftStore = useShiftStore();
const authStore = useAuthStore();

const terminal = 'Lane #1';
const cashierName = computed(() => authStore.user?.username ?? 'cashier');

const billCounts = ref<BillCounts>({});

const open = computed({
    get: () => shiftStore.shiftInOpen,
    set: (val) => (shiftStore.shiftInOpen = val),
});

const total = computed(() =>
    ALL_DENOMINATIONS.reduce(
        (sum, d) => sum + (billCounts.value[d.id] ?? 0) * d.value,
        0,
    ),
);

const totalPieces = computed(() =>
    Object.values(billCounts.value).reduce(
        (sum: number, c: number) => sum + (c || 0),
        0,
    ),
);

function currency(value: number): string {
    return formatCurrency(value);
}

function confirm() {
    if (total.value <= 0) return;
    shiftStore.startShift(
        cashierName.value,
        terminal,
        billCounts.value,
        total.value,
    );
    // Route handled by the caller after modal closes (goToRegister flow)
    import('@/router').then(({ default: router }) => {
        router.push({ name: 'Sell' });
    });
}
</script>
