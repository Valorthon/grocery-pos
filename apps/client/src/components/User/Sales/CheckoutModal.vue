<template>
    <BaseModal
        v-model="model"
        :error="error"
        error-testid="checkout-error"
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
                class="p-3.5 sm:p-4 bg-paper rounded-card border border-line text-center"
            >
                <span
                    class="text-xs font-bold uppercase tracking-wider text-muted"
                >
                    Total Due Amount
                </span>
                <div
                    class="min-w-0 text-2xl min-[360px]:text-3xl sm:text-4xl font-display num font-[800] text-ink tracking-tight mt-0.5"
                >
                    {{ currency(total) }}
                </div>
            </div>

            <div class="mt-4">
                <span
                    class="block text-xs font-bold uppercase tracking-wider text-muted mb-2"
                >
                    Select Payment Method
                </span>
                <!--
                    A radio group (#324): one Tab stop, ←/→ move and
                    select without wrapping; F1/F3/F6 pick a method from
                    anywhere in the dialog.
                -->
                <div
                    role="radiogroup"
                    aria-label="Payment method"
                    class="grid grid-cols-3 gap-2"
                    data-testid="payment-methods"
                    @keydown="onMethodKeydown"
                >
                    <button
                        v-for="option in methodOptions"
                        :key="option.type"
                        type="button"
                        role="radio"
                        :aria-checked="method === option.type"
                        :tabindex="method === option.type ? 0 : -1"
                        :aria-keyshortcuts="METHOD_KEYS[option.type]"
                        :data-method="option.type"
                        class="min-h-11 py-3 px-2 rounded-control border text-xs font-bold flex flex-col items-center gap-1.5 transition-all active:scale-[0.98] focus-ring"
                        :class="
                            method === option.type
                                ? 'bg-leaf-800 text-white border-ink shadow-2xs'
                                : 'bg-surface text-muted border-line hover:bg-leaf-50'
                        "
                        :disabled="isMethodDisabled(option.type)"
                        @click="selectMethod(option.type)"
                    >
                        <component :is="option.icon" class="w-5 h-5" />
                        <span>{{ option.label }}</span>
                        <!-- Hidden on phones, like the scan box's F2 (#89). -->
                        <span class="hidden sm:inline-flex">
                            <KeyHint
                                :tone="
                                    method === option.type ? 'dark' : 'light'
                                "
                                >{{ METHOD_KEYS[option.type] }}</KeyHint
                            >
                        </span>
                    </button>
                </div>
            </div>

            <!-- CASH -->
            <div
                v-if="method === PaymentType.CASH"
                class="space-y-3 bg-paper p-4 rounded-control border border-line mt-4"
            >
                <div class="flex items-center justify-between">
                    <label
                        class="text-xs font-bold uppercase tracking-wider text-muted"
                    >
                        Amount Tendered
                    </label>
                    <span class="text-xs font-bold text-ink"
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
                        class="min-h-11 min-w-11 px-3 py-1.5 rounded-control bg-surface border border-line text-sm font-bold text-muted hover:bg-leaf-50 active:scale-[0.98] focus-ring"
                        :aria-pressed="isPicked(amountTendered, total)"
                        @click="pickQuickCash(total, 'cash')"
                    >
                        Exact
                    </button>
                    <button
                        v-for="amount in quickCash"
                        :key="amount"
                        type="button"
                        class="min-h-11 min-w-11 px-3 py-1.5 rounded-control bg-surface border border-line text-sm font-bold text-muted hover:bg-leaf-50 active:scale-[0.98] focus-ring"
                        :aria-pressed="isPicked(amountTendered, amount)"
                        @click="pickQuickCash(amount, 'cash')"
                    >
                        {{ currency(amount) }}
                    </button>
                </div>

                <div class="relative">
                    <span
                        class="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-muted"
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
                        class="w-full min-h-11 pl-8 pr-4 py-2 rounded-control border border-line-strong bg-surface text-sm font-bold focus:outline-2 focus:outline-offset-0 focus:outline-leaf-500"
                        @keydown="onCashKeydown($event, 'cash')"
                    />
                </div>

                <div
                    :id="changeId"
                    class="flex items-center justify-between p-2.5 bg-surface rounded-control border border-line"
                >
                    <span class="text-xs font-bold text-muted"
                        >Change Due:</span
                    >
                    <span
                        class="text-base font-bold"
                        :class="
                            isCashSufficient
                                ? 'text-success-fg'
                                : 'text-danger-fg'
                        "
                    >
                        {{ currency(changeDue) }}
                    </span>
                </div>
            </div>

            <!-- GCASH -->
            <div
                v-else-if="method === PaymentType.GCASH"
                class="space-y-3 bg-paper p-4 rounded-control border border-line mt-4"
            >
                <label
                    class="block text-xs font-bold uppercase tracking-wider text-muted"
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
                    class="w-full min-h-11 px-3 py-2 rounded-control border bg-surface text-sm font-bold focus:outline-2 focus:outline-offset-0 focus:outline-leaf-500"
                    :class="
                        showReferenceError
                            ? 'border-danger-border'
                            : 'border-line-strong'
                    "
                />
                <p
                    v-if="showReferenceError"
                    :id="referenceErrorId"
                    data-testid="reference-error"
                    class="text-xs font-semibold text-danger-fg"
                >
                    {{ referenceError }}
                </p>
            </div>

            <!-- SPLIT -->
            <div v-else class="space-y-3 mt-4">
                <div
                    class="p-4 rounded-control border border-line bg-paper space-y-2.5"
                >
                    <div class="flex items-center justify-between">
                        <label class="text-xs font-bold text-ink"
                            >1. Customer Cash Given:</label
                        >
                        <span class="text-xs font-semibold text-muted"
                            >Total bill:
                            <strong class="text-ink num">{{
                                currency(total)
                            }}</strong></span
                        >
                    </div>

                    <div class="flex flex-wrap gap-1.5 items-center">
                        <button
                            v-for="bill in splitBills"
                            :key="bill"
                            type="button"
                            class="min-h-11 min-w-11 px-3 py-1.5 rounded-control bg-surface border border-line text-sm font-bold text-muted hover:bg-leaf-50 active:scale-[0.98] focus-ring"
                            :aria-pressed="isPicked(splitCashGiven, bill)"
                            @click="pickQuickCash(bill, 'split')"
                        >
                            {{ currency(bill) }}
                        </button>
                    </div>

                    <div class="relative">
                        <span
                            class="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-muted"
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
                            class="w-full min-h-11 pl-8 pr-4 py-2 rounded-control border border-line-strong bg-surface text-sm font-bold focus:outline-2 focus:outline-offset-0 focus:outline-leaf-500"
                            @keydown="onCashKeydown($event, 'split')"
                        />
                    </div>
                </div>

                <template v-if="split.cash > 0">
                    <div
                        class="p-4 rounded-control border border-line bg-paper space-y-3"
                    >
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-bold text-ink"
                                >2. Calculated GCash / QR Due:</span
                            >
                            <span
                                class="text-sm num font-bold text-ink"
                                data-testid="split-gcash"
                                >{{ currency(split.gcash) }}</span
                            >
                        </div>

                        <div v-if="!split.coversTotal" class="space-y-2">
                            <label
                                class="block text-xs font-bold uppercase tracking-wider text-muted"
                            >
                                Reference Number
                            </label>
                            <input
                                v-model="referenceNumber"
                                :form="formId"
                                aria-label="GCash reference number"
                                data-split-reference
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
                                class="w-full min-h-11 px-3 py-2 rounded-control border bg-surface text-sm font-bold focus:outline-2 focus:outline-offset-0 focus:outline-leaf-500"
                                :class="
                                    showReferenceError
                                        ? 'border-danger-border'
                                        : 'border-line-strong'
                                "
                            />
                            <p
                                v-if="showReferenceError"
                                :id="referenceErrorId"
                                data-testid="reference-error"
                                class="text-xs font-semibold text-danger-fg"
                            >
                                {{ referenceError }}
                            </p>
                        </div>
                        <div
                            v-else
                            data-testid="split-covered"
                            class="p-3 bg-success-bg border border-success-border rounded-control text-xs text-success-fg font-semibold"
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
                        :id="changeId"
                        class="flex items-center justify-between p-2.5 bg-surface rounded-control border border-line"
                    >
                        <span class="text-xs font-bold text-muted"
                            >Change Due:</span
                        >
                        <span
                            class="text-base font-bold text-success-fg"
                            data-testid="split-change"
                        >
                            {{ currency(split.changeDue) }}
                        </span>
                    </div>

                    <div
                        v-if="!split.coversTotal"
                        class="p-2.5 rounded-control bg-leaf-800 text-white flex items-center justify-between text-xs font-semibold"
                    >
                        <span>Split Breakdown:</span>
                        <span class="num text-xs">
                            Cash {{ currency(split.cash) }} + GCash
                            {{ currency(split.gcash) }} =
                            {{ currency(total) }}
                        </span>
                    </div>
                </template>
                <div
                    v-else
                    class="p-4 rounded-control border border-dashed border-line-strong bg-paper text-center text-xs text-muted"
                >
                    Enter the cash amount given by the customer above.
                </div>
            </div>
        </fieldset>

        <template #footer>
            <BaseButton
                variant="outline"
                :disabled="processing"
                @click="model = false"
                >Back</BaseButton
            >
            <BaseButton
                :id="confirmId"
                :aria-describedby="changeShown ? changeId : undefined"
                type="submit"
                :form="formId"
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
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    useId,
    useTemplateRef,
    watch,
} from 'vue';
import { Banknote, QrCode, Split } from '@lucide/vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import KeyHint from '@/components/ui/KeyHint.vue';
import { type PaymentRequest, PaymentType } from '@grocery-pos/contracts';
import {
    CENTAVOS_PER_PESO,
    centavosToPesoInput,
    formatCurrency,
    pesosToCentavos,
} from '@/utils/currency';
import {
    buildPayment,
    cashTender,
    METHOD_KEYS,
    quickCashAmounts,
    referenceNumberError,
    splitTender,
    stepQuickCash,
} from './checkout';

const props = defineProps<{
    modelValue: boolean;
    /** Preview total due, in centavos, from `previewSale` in Sell.vue. */
    total: number;
    initialMethod?: PaymentType;
    cashOnly?: boolean;
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
const confirmId = `${formId}-confirm`;

const changeId = `${formId}-change`;
/** The Change Due row is on screen: CASH, or SPLIT once cash is given. */
const changeShown = computed(
    () =>
        method.value === PaymentType.CASH ||
        (method.value === PaymentType.SPLIT && split.value.cash > 0),
);

/**
 * A quick-cash or split bill button fills its amount, then hands the focus
 * on (#197) so Enter doesn't press the same button again: to Confirm when
 * the payment is valid (Confirm describes itself with the Change Due), else
 * to the GCash reference a real split still needs. Confirm is the form's
 * submit button and `finish` ignores a submit while processing, so Enter
 * can't send the sale twice.
 */
async function pickQuickCash(amount: number, field: 'cash' | 'split') {
    (field === 'cash' ? amountTendered : splitCashGiven).value =
        centavosToPesoInput(amount);
    await nextTick();
    const next = canConfirm.value
        ? document.getElementById(confirmId)
        : fields.value?.querySelector<HTMLElement>('[data-split-reference]');
    next?.focus();
}

function currency(value: number): string {
    return formatCurrency(value);
}

const methodOptions = [
    { type: PaymentType.CASH, label: 'Cash', icon: Banknote },
    { type: PaymentType.GCASH, label: 'GCash', icon: QrCode },
    { type: PaymentType.SPLIT, label: 'Split', icon: Split },
] as const;

function isMethodDisabled(type: PaymentType): boolean {
    return !!props.cashOnly && type !== PaymentType.CASH;
}

/**
 * Picks a method. A click or F1/F3/F6 goes on to its amount or reference
 * field; ←/→ (`focus: 'radio'`) keep the focus on the radio, as native
 * radios do.
 */
async function selectMethod(
    next: PaymentType,
    focus: 'field' | 'radio' = 'field',
) {
    if (isMethodDisabled(next)) return;
    method.value = next;
    if (next === PaymentType.CASH && !amountTendered.value) {
        amountTendered.value = centavosToPesoInput(total.value);
    }
    await nextTick();
    const target =
        focus === 'radio' ? `[data-method="${next}"]` : '[data-autofocus]';
    fields.value?.querySelector<HTMLElement>(target)?.focus();
}

const hasModifier = (e: KeyboardEvent) =>
    e.altKey || e.ctrlKey || e.metaKey || e.shiftKey;

/** ←/→ in the radio group: the neighbouring enabled method, no wrap. */
function onMethodKeydown(event: KeyboardEvent) {
    if (hasModifier(event)) return;
    const step =
        event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const order = methodOptions.map((o) => o.type);
    for (
        let i = order.indexOf(method.value) + step;
        i >= 0 && i < order.length;
        i += step
    ) {
        if (!isMethodDisabled(order[i])) {
            void selectMethod(order[i], 'radio');
            return;
        }
    }
}

/**
 * F1/F3/F6 anywhere in this dialog (#324). The default is always
 * prevented there, so the browser's Help, Find and address-bar keys never
 * fire; mid-sale or for a disabled method the key does nothing else.
 */
function onDialogKeydown(event: KeyboardEvent) {
    if (!props.modelValue || hasModifier(event)) return;
    const type = methodOptions.find(
        (o) => METHOD_KEYS[o.type] === event.key,
    )?.type;
    if (!type) return;
    const dialog = fields.value?.closest('[role="dialog"]');
    if (!dialog?.contains(document.activeElement)) return;
    event.preventDefault();
    if (processing.value) return;
    void selectMethod(type);
}

onMounted(() => window.addEventListener('keydown', onDialogKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onDialogKeydown));

/** The quick-cash button showing the field's value is pressed (#324). */
function isPicked(input: string | number, amount: number): boolean {
    return String(input).trim() !== '' && pesosToCentavos(input) === amount;
}

/**
 * ↓/↑ in the Cash or Split cash field step through its quick amounts
 * (#324) instead of spinning the number by a centavo: from the field's
 * value, stopping at the ends. The value is selected so typing replaces
 * it, and the focus stays, so Enter then confirms.
 */
function onCashKeydown(event: KeyboardEvent, field: 'cash' | 'split') {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (hasModifier(event)) return;
    event.preventDefault();
    const input = field === 'cash' ? amountTendered : splitCashGiven;
    const amounts =
        field === 'cash' ? [total.value, ...quickCash.value] : splitBills;
    const next = stepQuickCash(
        amounts,
        pesosToCentavos(input.value),
        event.key === 'ArrowDown' ? 'down' : 'up',
    );
    if (next === null) return;
    input.value = centavosToPesoInput(next);
    const el = event.currentTarget;
    void nextTick(() => {
        if (el instanceof HTMLInputElement) el.select();
    });
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
