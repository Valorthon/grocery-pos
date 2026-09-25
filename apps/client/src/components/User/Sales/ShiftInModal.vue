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

        <p v-if="error" class="mt-3 text-xs font-semibold text-red-600">
            {{ error }}
        </p>

        <template #footer>
            <BaseButton
                variant="outline"
                :disabled="submitting"
                @click="open = false"
                >Cancel</BaseButton
            >
            <BaseButton
                class="flex-1"
                :loading="submitting"
                :disabled="total <= 0"
                @click="confirm"
            >
                Open Register
                <ArrowRight class="w-4 h-4" />
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowRight, ShieldCheck } from '@lucide/vue';
import { billCountTotal, DEFAULT_TERMINAL } from '@grocery-pos/contracts';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BillCountInput from './BillCountInput.vue';
import { countPieces } from './shift';
import type { BillCounts } from './shift';
import { apiErrorMessage, useShiftStore } from '@/stores/shift';
import { useAuthStore } from '@/stores/auth';
import { formatCurrency } from '@/utils/currency';

const shiftStore = useShiftStore();
const authStore = useAuthStore();

// A label until terminals get an identity of their own (#47).
const terminal = DEFAULT_TERMINAL;
const cashierName = computed(() => authStore.user?.username ?? 'cashier');

const billCounts = ref<BillCounts>({});
const submitting = ref(false);
const error = ref('');

const open = computed({
    get: () => shiftStore.shiftInOpen,
    set: (val) => {
        if (!submitting.value) shiftStore.shiftInOpen = val;
    },
});

watch(
    () => shiftStore.shiftInOpen,
    (val) => {
        if (val) {
            billCounts.value = {};
            error.value = '';
        }
    },
);

// Display only: the server adds the counts up itself.
const total = computed(() => billCountTotal(billCounts.value));
const totalPieces = computed(() => countPieces(billCounts.value));

function currency(value: number): string {
    return formatCurrency(value);
}

async function confirm() {
    if (total.value <= 0 || submitting.value) return;
    submitting.value = true;
    error.value = '';
    try {
        await shiftStore.openShift(billCounts.value);
        const { default: router } = await import('@/router');
        await router.push({ name: 'Sell' });
    } catch (err) {
        error.value = apiErrorMessage(err, 'Could not open the shift');
    } finally {
        submitting.value = false;
    }
}
</script>
