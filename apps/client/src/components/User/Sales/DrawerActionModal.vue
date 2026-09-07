<template>
    <BaseModal
        v-model="open"
        :title="
            isCashIn
                ? 'Cash In (Add Change / Float)'
                : 'Cash Drop (Skim to Safe)'
        "
        :subtitle="
            isCashIn
                ? 'Add change when drawer coins or bills run low'
                : 'Transfer excess cash safely out of drawer'
        "
        max-width="28rem"
    >
        <div class="space-y-4 text-xs">
            <div>
                <label class="block font-bold text-slate-700 mb-1">
                    Amount to {{ isCashIn ? 'Add' : 'Drop' }} (₱)
                </label>
                <div class="relative">
                    <span
                        class="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-sm"
                        >₱</span
                    >
                    <input
                        v-model="amount"
                        type="number"
                        min="1"
                        step="any"
                        class="w-full pl-7 pr-3 py-2 text-base font-mono font-black text-slate-900 border border-slate-300 rounded-xl focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                    />
                </div>

                <div class="flex items-center gap-1.5 mt-2">
                    <button
                        v-for="q in quickAmounts"
                        :key="q"
                        type="button"
                        class="px-2.5 py-1 rounded-lg border font-bold text-[11px] transition-colors active:scale-[0.98]"
                        :class="
                            numericAmount === q
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700'
                        "
                        @click="amount = q.toString()"
                    >
                        ₱{{ q.toLocaleString() }}
                    </button>
                </div>
            </div>

            <div>
                <label class="block font-bold text-slate-700 mb-1">
                    Reason / Notes
                </label>
                <input
                    v-model="reason"
                    type="text"
                    placeholder="e.g., Adding ₱5 and ₱10 coins..."
                    class="w-full px-3 py-2 text-xs text-slate-800 border border-slate-300 rounded-xl focus:outline-none focus:border-primary-500"
                />
            </div>

            <p v-if="error" class="text-red-600 font-semibold">{{ error }}</p>
        </div>

        <template #footer>
            <BaseButton variant="outline" @click="open = false"
                >Cancel</BaseButton
            >
            <BaseButton
                class="flex-1"
                :disabled="numericAmount <= 0"
                @click="confirm"
            >
                <Check class="w-3.5 h-3.5" />
                Confirm {{ isCashIn ? 'Cash In' : 'Cash Drop' }}
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check } from '@lucide/vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useShiftStore } from '@/stores/shift';
import { useUIStore, Color } from '@/stores/ui';
import { formatCurrency } from '@/utils/currency';

const shiftStore = useShiftStore();
const uiStore = useUIStore();

const amount = ref('500');
const reason = ref('');
const error = ref('');

const open = computed({
    get: () => shiftStore.drawerAction !== null,
    set: (val) => {
        if (!val) shiftStore.drawerAction = null;
    },
});

const type = computed(() => shiftStore.drawerAction);
const isCashIn = computed(() => type.value === 'cash_in');

const numericAmount = computed(() => parseFloat(amount.value) || 0);

const quickAmounts = computed(() =>
    isCashIn.value ? [200, 500, 1000, 2000] : [1000, 2000, 3000, 5000],
);

watch(
    () => shiftStore.drawerAction,
    (action) => {
        if (action) {
            amount.value = '500';
            reason.value =
                action === 'cash_in'
                    ? 'Change replenishment'
                    : 'Excess cash drop to safe';
            error.value = '';
        }
    },
);

function currency(value: number): string {
    return formatCurrency(value);
}

function confirm() {
    if (numericAmount.value <= 0) return;

    if (!isCashIn.value && numericAmount.value > shiftStore.currentDrawerCash) {
        error.value = `Cannot drop more cash than currently in drawer (${currency(
            shiftStore.currentDrawerCash,
        )})`;
        uiStore.queueMessage(Color.ERROR, error.value);
        return;
    }

    shiftStore.addDrawerTransaction(
        type.value as 'cash_in' | 'cash_drop',
        numericAmount.value,
        reason.value.trim() ||
            (isCashIn.value ? 'Cash In (Change)' : 'Cash Drop (Safe)'),
    );
    shiftStore.drawerAction = null;
}
</script>
