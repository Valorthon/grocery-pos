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
        :closable="!submitting"
    >
        <div class="space-y-4 text-xs">
            <div>
                <label
                    for="drawer-amount"
                    class="block font-bold text-slate-700 mb-1"
                >
                    Amount to {{ isCashIn ? 'Add' : 'Drop' }} (₱)
                </label>
                <div class="relative">
                    <span
                        class="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-sm"
                        >₱</span
                    >
                    <input
                        id="drawer-amount"
                        v-model="amount"
                        type="text"
                        inputmode="decimal"
                        autocomplete="off"
                        placeholder="0.00"
                        data-testid="drawer-amount"
                        :aria-invalid="errors.amount ? 'true' : undefined"
                        :aria-describedby="
                            errors.amount ? 'drawer-amount-error' : undefined
                        "
                        class="w-full pl-7 pr-3 py-2 text-base font-mono font-black text-slate-900 border rounded-xl focus:outline-none focus:ring-1"
                        :class="
                            errors.amount
                                ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                                : 'border-slate-300 focus:border-primary-500 focus:ring-primary-500'
                        "
                    />
                </div>
                <p
                    v-if="errors.amount"
                    id="drawer-amount-error"
                    class="mt-1 text-red-600"
                    data-testid="drawer-amount-error"
                >
                    {{ errors.amount }}
                </p>

                <div class="flex items-center gap-1.5 mt-2">
                    <button
                        v-for="q in quickAmounts"
                        :key="q"
                        type="button"
                        class="px-2.5 py-1 rounded-lg border font-bold text-xs transition-colors active:scale-[0.98]"
                        :class="
                            amountCentavos === q
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700'
                        "
                        @click="amount = centavosToPesoInput(q)"
                    >
                        {{ currency(q) }}
                    </button>
                </div>
            </div>

            <div>
                <label
                    for="drawer-reason"
                    class="block font-bold text-slate-700 mb-1"
                >
                    Reason
                </label>
                <input
                    id="drawer-reason"
                    v-model="reason"
                    type="text"
                    :maxlength="STRING_LIMITS.REASON"
                    :placeholder="
                        isCashIn
                            ? 'e.g., ₱1 and ₱5 coins for change'
                            : 'e.g., Excess bills to the safe'
                    "
                    data-testid="drawer-reason"
                    :aria-invalid="errors.reason ? 'true' : undefined"
                    :aria-describedby="
                        errors.reason ? 'drawer-reason-error' : undefined
                    "
                    class="w-full px-3 py-2 text-xs text-slate-800 border rounded-xl focus:outline-none"
                    :class="
                        errors.reason
                            ? 'border-red-400 focus:border-red-500'
                            : 'border-slate-300 focus:border-primary-500'
                    "
                />
                <p
                    v-if="errors.reason"
                    id="drawer-reason-error"
                    class="mt-1 text-red-600"
                    data-testid="drawer-reason-error"
                >
                    {{ errors.reason }}
                </p>
            </div>
        </div>

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
                data-testid="drawer-confirm"
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
import {
    DrawerMovementType,
    NUMERIC_LIMITS,
    STRING_LIMITS,
} from '@grocery-pos/contracts';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { apiErrorMessage, useShiftStore } from '@/stores/shift';
import { useUIStore, Color } from '@/stores/ui';
import {
    CENTAVOS_PER_PESO,
    centavosToPesoInput,
    formatCurrency,
    parsePesos,
} from '@/utils/currency';
import { fieldErrors, moneyError, textError } from '@/utils/rules';

const shiftStore = useShiftStore();
const uiStore = useUIStore();

// Both start empty on every open (issue #25): a distracted tap must not
// book a pre-filled amount, and every movement says why it happened.
const amount = ref('');
const reason = ref('');
const errors = ref<Record<string, string>>({});
const submitting = ref(false);

const open = computed({
    get: () => shiftStore.drawerAction !== null,
    set: (val) => {
        if (!val && !submitting.value) shiftStore.drawerAction = null;
    },
});

const type = computed(() => shiftStore.drawerAction);
const isCashIn = computed(() => type.value === DrawerMovementType.CASH_IN);

/** Only highlights the matching quick amount; null while blank or mistyped. */
const amountCentavos = computed(() => parsePesos(amount.value));

const quickAmounts = computed(() =>
    (isCashIn.value ? [200, 500, 1000, 2000] : [1000, 2000, 3000, 5000]).map(
        (pesos) => pesos * CENTAVOS_PER_PESO,
    ),
);

watch(
    () => shiftStore.drawerAction,
    (action) => {
        if (action) {
            amount.value = '';
            reason.value = '';
            errors.value = {};
        }
    },
);

// A field's error clears once it is edited; it is checked again on submit.
watch(amount, () => {
    delete errors.value.amount;
});
watch(reason, () => {
    delete errors.value.reason;
});

function currency(value: number): string {
    return formatCurrency(value);
}

/**
 * Records the movement on the server. The rules mirror `DrawerMovementDto`:
 * an amount of AMOUNT_MIN to AMOUNT_MAX centavos and a non-blank reason of
 * at most STRING_LIMITS.REASON. A cash drop is not checked against the
 * drawer (the cashier never sees expected cash, #2): a drop larger than
 * what is there shows up as a shortfall in the Z-read.
 */
async function confirm() {
    const action = type.value;
    if (!action || submitting.value) return;

    errors.value = fieldErrors({
        amount: moneyError(amount.value, NUMERIC_LIMITS.AMOUNT_MIN),
        reason: textError(reason.value, STRING_LIMITS.REASON),
    });
    const centavos = parsePesos(amount.value);
    if (Object.keys(errors.value).length > 0 || centavos === null) return;

    submitting.value = true;
    try {
        await shiftStore.recordDrawer(action, centavos, reason.value.trim());
        uiStore.queueMessage(
            Color.SUCCESS,
            `${isCashIn.value ? 'Cash in' : 'Cash drop'} of ${currency(centavos)} recorded`,
        );
        shiftStore.drawerAction = null;
    } catch (err) {
        uiStore.queueMessage(
            Color.ERROR,
            apiErrorMessage(err, 'Could not record the movement'),
        );
    } finally {
        submitting.value = false;
    }
}
</script>
