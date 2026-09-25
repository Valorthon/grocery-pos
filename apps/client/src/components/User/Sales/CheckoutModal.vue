<template>
    <BaseModal
        v-model="model"
        title="Complete Payment"
        subtitle="Select tender method or split payment across Cash & GCash"
        max-width="34rem"
        scrollable
        :closable="!processing"
    >
        <!--
            Enter in a field confirms (issue #22): the fields and the footer's
            Confirm button belong to this form (their `form` attribute), and
            Confirm is disabled until the payment is valid. Escape cancels
            unless the sale is processing (BaseModal is not closable then).
        -->
        <form :id="formId" novalidate class="hidden" @submit.prevent="finish" />
        <!-- Disabled while the sale is in flight: what is sent cannot change. -->
        <fieldset ref="fields" :disabled="processing" class="contents">
            <div
                class="p-3.5 sm:p-4 bg-slate-50 rounded-2xl border border-slate-200 text-center"
            >
                <span
                    class="text-xs font-bold uppercase tracking-wider text-slate-500"
                >
                    Total Due Amount
                </span>
                <div
                    class="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight mt-0.5"
                >
                    {{ currency(total) }}
                </div>
            </div>

            <div class="mt-4">
                <label
                    class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2"
                >
                    Select Payment Method
                </label>
                <div class="grid grid-cols-3 gap-2">
                    <button
                        type="button"
                        class="min-h-11 py-3 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1.5 transition-all active:scale-[0.98]"
                        :class="
                            method === PaymentType.CASH
                                ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        "
                        @click="selectMethod(PaymentType.CASH)"
                    >
                        <Banknote class="w-5 h-5" />
                        <span>Cash</span>
                    </button>

                    <button
                        type="button"
                        class="min-h-11 py-3 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1.5 transition-all active:scale-[0.98]"
                        :class="
                            method === PaymentType.GCASH
                                ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        "
                        @click="selectMethod(PaymentType.GCASH)"
                    >
                        <QrCode class="w-5 h-5" />
                        <span>GCash</span>
                    </button>

                    <button
                        type="button"
                        class="min-h-11 py-3 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1.5 transition-all active:scale-[0.98]"
                        :class="
                            method === PaymentType.SPLIT
                                ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        "
                        @click="selectMethod(PaymentType.SPLIT)"
                    >
                        <Split class="w-5 h-5" />
                        <span>Split</span>
                    </button>
                </div>
            </div>

            <!-- CASH -->
            <div
                v-if="method === PaymentType.CASH"
                class="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200 mt-4"
            >
                <div class="flex items-center justify-between">
                    <label
                        class="text-xs font-bold uppercase tracking-wider text-slate-500"
                    >
                        Amount Tendered
                    </label>
                    <span class="text-xs font-bold text-slate-800"
                        >Exact: {{ currency(total) }}</span
                    >
                </div>

                <!--
                    Quick cash (decision 2026-09-25, #23): Exact plus the
                    next amounts a customer is likely to hand over. Any
                    other amount can still be typed.
                -->
                <div
                    class="flex flex-wrap gap-1.5"
                    role="group"
                    aria-label="Quick cash amounts"
                    data-testid="quick-cash"
                >
                    <button
                        type="button"
                        class="min-h-11 min-w-11 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-100 active:scale-[0.98] focus-ring"
                        @click="amountTendered = centavosToPesoInput(total)"
                    >
                        Exact
                    </button>
                    <button
                        v-for="amount in quickCash"
                        :key="amount"
                        type="button"
                        class="min-h-11 min-w-11 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-100 active:scale-[0.98] focus-ring"
                        @click="amountTendered = centavosToPesoInput(amount)"
                    >
                        {{ currency(amount) }}
                    </button>
                </div>

                <div class="relative">
                    <span
                        class="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400"
                        >₱</span
                    >
                    <input
                        v-model="amountTendered"
                        :form="formId"
                        data-autofocus
                        aria-label="Amount tendered"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        class="w-full min-h-11 pl-8 pr-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold focus:outline-none focus:border-slate-800"
                    />
                </div>

                <div
                    class="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-200"
                >
                    <span class="text-xs font-bold text-slate-500"
                        >Change Due:</span
                    >
                    <span
                        class="text-base font-extrabold"
                        :class="
                            isCashSufficient
                                ? 'text-emerald-700'
                                : 'text-red-600'
                        "
                    >
                        {{ currency(changeDue) }}
                    </span>
                </div>
            </div>

            <!-- GCASH -->
            <div
                v-else-if="method === PaymentType.GCASH"
                class="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200 mt-4"
            >
                <label
                    class="block text-xs font-bold uppercase tracking-wider text-slate-500"
                >
                    Reference Number
                </label>
                <input
                    v-model="referenceNumber"
                    :form="formId"
                    data-autofocus
                    aria-label="GCash reference number"
                    type="text"
                    inputmode="numeric"
                    autocomplete="off"
                    placeholder="13-digit GCash reference number"
                    :aria-invalid="showReferenceError"
                    :aria-describedby="
                        showReferenceError ? referenceErrorId : undefined
                    "
                    class="w-full min-h-11 px-3 py-2 rounded-xl border bg-white text-sm font-bold focus:outline-none focus:border-slate-800"
                    :class="
                        showReferenceError
                            ? 'border-red-400'
                            : 'border-slate-300'
                    "
                />
                <p
                    v-if="showReferenceError"
                    :id="referenceErrorId"
                    data-testid="reference-error"
                    class="text-xs font-semibold text-red-600"
                >
                    {{ referenceError }}
                </p>
            </div>

            <!-- SPLIT -->
            <div v-else class="space-y-3 mt-4">
                <div
                    class="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5"
                >
                    <div class="flex items-center justify-between">
                        <label class="text-xs font-extrabold text-slate-900"
                            >1. Customer Cash Given:</label
                        >
                        <span class="text-xs font-semibold text-slate-500"
                            >Total bill:
                            <strong class="text-slate-800 font-mono">{{
                                currency(total)
                            }}</strong></span
                        >
                    </div>

                    <div class="flex flex-wrap gap-1.5 items-center">
                        <button
                            v-for="bill in splitBills"
                            :key="bill"
                            type="button"
                            class="min-h-11 min-w-11 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-100 active:scale-[0.98] focus-ring"
                            @click="splitCashGiven = centavosToPesoInput(bill)"
                        >
                            {{ currency(bill) }}
                        </button>
                    </div>

                    <div class="relative">
                        <span
                            class="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400"
                            >₱</span
                        >
                        <input
                            v-model="splitCashGiven"
                            :form="formId"
                            data-autofocus
                            aria-label="Customer cash given"
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="Enter cash handed by customer"
                            class="w-full min-h-11 pl-8 pr-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold focus:outline-none focus:border-slate-800"
                        />
                    </div>
                </div>

                <template v-if="split.cash > 0">
                    <div
                        class="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3"
                    >
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-extrabold text-slate-900"
                                >2. Calculated GCash / QR Due:</span
                            >
                            <span
                                class="text-sm font-mono font-black text-slate-900"
                                data-testid="split-gcash"
                                >{{ currency(split.gcash) }}</span
                            >
                        </div>

                        <div v-if="!split.coversTotal" class="space-y-2">
                            <label
                                class="block text-xs font-bold uppercase tracking-wider text-slate-500"
                            >
                                Reference Number
                            </label>
                            <input
                                v-model="referenceNumber"
                                :form="formId"
                                aria-label="GCash reference number"
                                type="text"
                                inputmode="numeric"
                                autocomplete="off"
                                placeholder="13-digit GCash reference number"
                                :aria-invalid="showReferenceError"
                                :aria-describedby="
                                    showReferenceError
                                        ? referenceErrorId
                                        : undefined
                                "
                                class="w-full min-h-11 px-3 py-2 rounded-xl border bg-white text-sm font-bold focus:outline-none focus:border-slate-800"
                                :class="
                                    showReferenceError
                                        ? 'border-red-400'
                                        : 'border-slate-300'
                                "
                            />
                            <p
                                v-if="showReferenceError"
                                :id="referenceErrorId"
                                data-testid="reference-error"
                                class="text-xs font-semibold text-red-600"
                            >
                                {{ referenceError }}
                            </p>
                        </div>
                        <div
                            v-else
                            data-testid="split-covered"
                            class="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-semibold"
                        >
                            The cash covers the whole total, so no GCash is
                            needed and this is recorded as a cash sale.
                        </div>
                    </div>

                    <!--
                        Change before confirming (#23). GCash pays only what
                        the cash does not, so there is change only when the
                        cash alone covers the total; the server pays change
                        out of the cash tender too (settleTenders).
                    -->
                    <div
                        class="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-200"
                    >
                        <span class="text-xs font-bold text-slate-500"
                            >Change Due:</span
                        >
                        <span
                            class="text-base font-extrabold text-emerald-700"
                            data-testid="split-change"
                        >
                            {{ currency(split.changeDue) }}
                        </span>
                    </div>

                    <div
                        v-if="!split.coversTotal"
                        class="p-2.5 rounded-xl bg-slate-900 text-white flex items-center justify-between text-xs font-semibold"
                    >
                        <span>Split Breakdown:</span>
                        <span class="font-mono text-xs">
                            Cash {{ currency(split.cash) }} + GCash
                            {{ currency(split.gcash) }} =
                            {{ currency(total) }}
                        </span>
                    </div>
                </template>
                <div
                    v-else
                    class="p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center text-xs text-slate-500"
                >
                    Enter the cash amount given by the customer above.
                </div>
            </div>
        </fieldset>

        <div
            v-if="error"
            role="alert"
            class="mt-4 p-3 rounded-xl border border-red-200 bg-red-50 text-xs font-semibold text-red-700 flex items-start gap-2"
            data-testid="checkout-error"
        >
            <AlertCircle class="w-4 h-4 shrink-0 mt-px" />
            <span>{{ error }}</span>
        </div>

        <template #footer>
            <BaseButton
                variant="outline"
                :disabled="processing"
                @click="model = false"
                >Back</BaseButton
            >
            <BaseButton
                type="submit"
                :form="formId"
                class="flex-1"
                :loading="processing"
                :disabled="!canConfirm"
                aria-keyshortcuts="Enter"
                data-testid="checkout-confirm"
            >
                <template v-if="processing">
                    Processing Transaction...
                </template>
                <template v-else-if="error">
                    Retry ({{ currency(total) }})
                </template>
                <template
                    v-else-if="
                        method === PaymentType.SPLIT && !split.coversTotal
                    "
                >
                    Confirm Split ({{ currency(split.cash) }} Cash +
                    {{ currency(split.gcash) }} GCash)
                </template>
                <template v-else>
                    Confirm & Complete ({{ currency(total) }})
                </template>
                <KeyHint v-if="!processing" tone="dark">Enter</KeyHint>
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue';
import { AlertCircle, Banknote, QrCode, Split } from '@lucide/vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import KeyHint from '@/components/ui/KeyHint.vue';
import { PaymentType } from '@grocery-pos/contracts';
import type { PaymentRequest } from './types';
import {
    CENTAVOS_PER_PESO,
    centavosToPesoInput,
    formatCurrency,
} from '@/utils/currency';
import {
    buildPayment,
    cashTender,
    quickCashAmounts,
    referenceNumberError,
    splitTender,
} from './checkout';

const props = defineProps<{
    modelValue: boolean;
    /** Preview total due, in centavos, from `previewSale` in Sell.vue. */
    total: number;
    initialMethod?: PaymentType;
    initialCash?: number | null;
    /**
     * Records the sale (`POST /sales`). The modal stays open until it
     * settles: it closes when it resolves and shows the error inline, with
     * Retry, when it rejects.
     */
    submit: (payment: PaymentRequest) => Promise<unknown>;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
}>();

const formId = useId();
const fields = useTemplateRef<HTMLFieldSetElement>('fields');
const processing = ref(false);
const error = ref<string | null>(null);

const model = computed({
    get: () => props.modelValue,
    set: (val) => {
        // Closing mid-request would hide whether the sale went through.
        if (!val && processing.value) return;
        emit('update:modelValue', val);
    },
});

const method = ref<PaymentType>(PaymentType.CASH);
const amountTendered = ref('');
const splitCashGiven = ref('');
const referenceNumber = ref('');
const referenceErrorId = useId();

// Money below is integer centavos; the two text inputs hold typed pesos and
// are converted once, on read.
const splitBills = [5, 10, 20, 50, 100, 500].map((p) => p * CENTAVOS_PER_PESO);

const total = computed(() => props.total);
const quickCash = computed(() => quickCashAmounts(total.value));

const cash = computed(() => cashTender(total.value, amountTendered.value));
const changeDue = computed(() => cash.value.changeDue);
const isCashSufficient = computed(() => cash.value.isSufficient);

const split = computed(() => splitTender(total.value, splitCashGiven.value));

const referenceError = computed(() =>
    referenceNumberError(referenceNumber.value),
);
/**
 * The reference's format error (13 digits, as the API requires), inline
 * once something is typed; Confirm stays disabled until it is valid. Only while a
 * reference is asked for; a split the cash covers needs none.
 */
const showReferenceError = computed(
    () =>
        (method.value === PaymentType.GCASH ||
            (method.value === PaymentType.SPLIT &&
                split.value.cash > 0 &&
                !split.value.coversTotal)) &&
        !!referenceError.value &&
        !!referenceNumber.value.trim(),
);

// What will be sent; null until the form is complete and valid.
const payment = computed(() =>
    buildPayment(method.value, total.value, {
        cash:
            method.value === PaymentType.SPLIT
                ? splitCashGiven.value
                : amountTendered.value,
        referenceNumber: referenceNumber.value,
    }),
);

const canConfirm = computed(() => payment.value !== null);

function currency(value: number): string {
    return formatCurrency(value);
}

async function selectMethod(next: PaymentType) {
    method.value = next;
    if (next === PaymentType.CASH && !amountTendered.value) {
        amountTendered.value = centavosToPesoInput(total.value);
    }
    // On to the new method's amount or reference field.
    await nextTick();
    fields.value?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
}

function reset() {
    method.value = props.initialMethod ?? PaymentType.CASH;
    amountTendered.value =
        props.initialCash != null ? centavosToPesoInput(props.initialCash) : '';
    splitCashGiven.value = '';
    referenceNumber.value = '';
    processing.value = false;
    error.value = null;
}

watch(
    () => props.modelValue,
    (open) => {
        if (open) reset();
    },
    { immediate: true },
);

async function finish() {
    const request = payment.value;
    if (!request || processing.value) return;

    processing.value = true;
    error.value = null;
    try {
        await props.submit(request);
        processing.value = false;
        model.value = false;
    } catch (err) {
        processing.value = false;
        error.value = err instanceof Error ? err.message : 'Sale failed';
        // The disabled fieldset dropped the focus to <body>: back to the
        // tender field, so a fix and Enter retry from the keyboard.
        await nextTick();
        fields.value?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
}
</script>
