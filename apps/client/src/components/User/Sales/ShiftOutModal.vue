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
            <span
                >Enter the cash you find in the drawer. The shift close report
                shows how it compares once you submit.</span
            >
        </div>

        <BillCountInput v-model="billCounts" />

        <div
            class="mt-4 bg-slate-900 text-white rounded-xl p-4 flex items-center justify-between"
        >
            <div>
                <div
                    class="text-[10px] text-slate-400 font-bold uppercase tracking-wider"
                >
                    Total Physical Counted Cash ({{ totalPieces }} pieces)
                </div>
                <div
                    class="text-2xl font-mono font-black text-primary-300 mt-0.5"
                    data-testid="counted-cash"
                >
                    {{ currency(countedCash) }}
                </div>
            </div>
            <div class="text-right">
                <span class="text-[11px] text-slate-400">Cashier:</span>
                <div class="text-xs font-bold text-slate-200">
                    {{ shiftStore.activeShift?.cashierName }}
                </div>
            </div>
        </div>

        <p
            v-if="error"
            class="mt-3 text-xs font-semibold text-red-600"
            data-testid="shift-out-error"
        >
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
                data-testid="shift-out-confirm"
                @click="confirm"
            >
                Submit Count & Close Shift
                <ArrowRight class="w-4 h-4" />
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowRight, ShieldCheck } from '@lucide/vue';
import { billCountTotal, ErrorCode } from '@grocery-pos/contracts';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BillCountInput from './BillCountInput.vue';
import { countPieces } from './shift';
import type { BillCounts } from './shift';
import { apiErrorCode, apiErrorMessage, useShiftStore } from '@/stores/shift';
import { Color, useUIStore } from '@/stores/ui';
import { formatCurrency } from '@/utils/currency';

/**
 * The closing count is blind (issue #2): the cashier sees only what they
 * counted, never the expected cash or a variance. The server computes both
 * and returns them in the Z-read after the count is submitted.
 */
const shiftStore = useShiftStore();
const uiStore = useUIStore();

const billCounts = ref<BillCounts>({});
const submitting = ref(false);
const error = ref('');

const open = computed({
    get: () => shiftStore.shiftOutOpen,
    set: (val) => {
        if (!submitting.value) shiftStore.shiftOutOpen = val;
    },
});

// Display only: the server adds the counts up itself.
const countedCash = computed(() => billCountTotal(billCounts.value));
const totalPieces = computed(() => countPieces(billCounts.value));

watch(
    () => shiftStore.shiftOutOpen,
    (val) => {
        if (val) {
            billCounts.value = {};
            error.value = '';
        }
    },
);

function currency(value: number): string {
    return formatCurrency(value);
}

async function confirm() {
    if (submitting.value) return;
    submitting.value = true;
    error.value = '';
    try {
        await shiftStore.closeShift(billCounts.value);
    } catch (err) {
        error.value = apiErrorMessage(err, 'Could not close the shift');
        if (apiErrorCode(err) === ErrorCode.SHIFT_NOT_OPEN) {
            // Closed elsewhere (e.g. by an admin): the modal has closed.
            uiStore.queueMessage(
                Color.ERROR,
                'This shift is no longer open. See the last shift report.',
            );
        }
    } finally {
        submitting.value = false;
    }
}
</script>
