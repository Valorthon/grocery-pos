<template>
    <BaseModal
        v-model="model"
        title="Complete Payment"
        subtitle="Select tender method or split payment across Cash & GCash"
        max-width="34rem"
        scrollable
    >
        <div
            class="p-3.5 sm:p-4 bg-slate-50 rounded-2xl border border-slate-200 text-center"
        >
            <span
                class="text-[11px] font-bold uppercase tracking-wider text-slate-500"
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
                    class="py-3 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1.5 transition-all active:scale-[0.98]"
                    :class="
                        method === 'CASH'
                            ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    "
                    @click="selectMethod('CASH')"
                >
                    <Banknote class="w-5 h-5" />
                    <span>Cash</span>
                </button>

                <button
                    type="button"
                    class="py-3 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1.5 transition-all active:scale-[0.98]"
                    :class="
                        method === 'GCASH'
                            ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    "
                    @click="selectMethod('GCASH')"
                >
                    <QrCode class="w-5 h-5" />
                    <span>GCash</span>
                </button>

                <button
                    type="button"
                    class="py-3 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1.5 transition-all active:scale-[0.98]"
                    :class="
                        method === 'SPLIT'
                            ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    "
                    @click="selectMethod('SPLIT')"
                >
                    <Split class="w-5 h-5" />
                    <span>Split</span>
                </button>
            </div>
        </div>

        <!-- CASH -->
        <div
            v-if="method === 'CASH'"
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

            <div class="flex flex-wrap gap-1.5">
                <button
                    type="button"
                    class="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 active:scale-[0.98]"
                    @click="amountTendered = centavosToPesoInput(total)"
                >
                    Exact
                </button>
                <button
                    type="button"
                    class="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 active:scale-[0.98]"
                    @click="
                        amountTendered = centavosToPesoInput(roundedUpTotal)
                    "
                >
                    {{ currency(roundedUpTotal) }}
                </button>
                <button
                    v-for="bill in cashBills"
                    :key="bill"
                    type="button"
                    class="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-30 active:scale-[0.98]"
                    :disabled="bill < total"
                    @click="amountTendered = centavosToPesoInput(bill)"
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
                    v-model="amountTendered"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    class="w-full pl-8 pr-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold focus:outline-none focus:border-slate-800"
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
                        isCashSufficient ? 'text-emerald-700' : 'text-red-600'
                    "
                >
                    {{ currency(changeDue) }}
                </span>
            </div>
        </div>

        <!-- GCASH -->
        <div
            v-else-if="method === 'GCASH'"
            class="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200 mt-4"
        >
            <label
                class="block text-xs font-bold uppercase tracking-wider text-slate-500"
            >
                Reference Number
            </label>
            <input
                v-model="referenceNumber"
                type="text"
                placeholder="Enter GCash reference number"
                class="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold focus:outline-none focus:border-slate-800"
            />
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
                    <span class="text-[11px] font-semibold text-slate-500"
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
                        class="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 active:scale-[0.98]"
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
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Enter cash handed by customer"
                        class="w-full pl-8 pr-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold focus:outline-none focus:border-slate-800"
                    />
                </div>
            </div>

            <template v-if="cashGivenNum > 0">
                <div
                    class="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3"
                >
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-extrabold text-slate-900"
                            >2. Calculated GCash / QR Due:</span
                        >
                        <span
                            class="text-sm font-mono font-black text-slate-900"
                            >{{ currency(splitOnlinePortion) }}</span
                        >
                    </div>

                    <div v-if="splitOnlinePortion > 0" class="space-y-2">
                        <label
                            class="block text-xs font-bold uppercase tracking-wider text-slate-500"
                        >
                            Reference Number
                        </label>
                        <input
                            v-model="referenceNumber"
                            type="text"
                            placeholder="Enter GCash reference number"
                            class="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold focus:outline-none focus:border-slate-800"
                        />
                    </div>
                    <div
                        v-else
                        class="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-semibold"
                    >
                        Cash given covers the full total!
                        <template v-if="splitCashChangeDue > 0">
                            — Cash Change:
                            {{ currency(splitCashChangeDue) }}</template
                        >
                    </div>
                </div>

                <div
                    class="p-2.5 rounded-xl bg-slate-900 text-white flex items-center justify-between text-xs font-semibold"
                >
                    <span>Split Breakdown:</span>
                    <span class="font-mono text-[11px]">
                        Cash {{ currency(splitCashPortion) }} + GCash
                        {{ currency(splitOnlinePortion) }} =
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

        <template #footer>
            <BaseButton variant="outline" @click="model = false"
                >Back</BaseButton
            >
            <BaseButton
                class="flex-1"
                :loading="processing"
                :disabled="!canConfirm"
                @click="finish"
            >
                <template v-if="processing">
                    Processing Transaction...
                </template>
                <template v-else-if="method === 'SPLIT'">
                    Confirm Split ({{ currency(splitCashPortion) }} Cash +
                    {{ currency(splitOnlinePortion) }} GCash)
                </template>
                <template v-else>
                    Confirm & Complete ({{ currency(total) }})
                </template>
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Banknote, QrCode, Split } from '@lucide/vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import type { PaymentInfo, PaymentMethod } from './types';
import {
    CENTAVOS_PER_PESO,
    centavosToPesoInput,
    formatCurrency,
    percentOf,
    pesosToCentavos,
} from '@/utils/currency';

const props = defineProps<{
    modelValue: boolean;
    subtotal: number;
    discountPercent: number;
    initialMethod?: PaymentMethod;
    initialCash?: number | null;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'complete', payment: PaymentInfo): void;
}>();

const model = computed({
    get: () => props.modelValue,
    set: (val) => emit('update:modelValue', val),
});

const method = ref<PaymentMethod>('CASH');
const amountTendered = ref('');
const splitCashGiven = ref('');
const referenceNumber = ref('');
const processing = ref(false);

// Money below is integer centavos; the two text inputs hold typed pesos and
// are converted once, on read.
const cashBills = [20, 50, 100, 500, 1000].map((p) => p * CENTAVOS_PER_PESO);
const splitBills = [5, 10, 20, 50, 100, 500].map((p) => p * CENTAVOS_PER_PESO);

const total = computed(
    () => props.subtotal - percentOf(props.subtotal, props.discountPercent),
);
const roundedUpTotal = computed(
    () => Math.ceil(total.value / CENTAVOS_PER_PESO) * CENTAVOS_PER_PESO,
);

const tenderedNum = computed(() => pesosToCentavos(amountTendered.value));
const changeDue = computed(() => Math.max(0, tenderedNum.value - total.value));
const isCashSufficient = computed(() => tenderedNum.value >= total.value);

const cashGivenNum = computed(() => pesosToCentavos(splitCashGiven.value));
const splitCashPortion = computed(() =>
    Math.min(total.value, cashGivenNum.value),
);
const splitOnlinePortion = computed(() =>
    Math.max(0, total.value - splitCashPortion.value),
);
const splitCashChangeDue = computed(() =>
    Math.max(0, cashGivenNum.value - total.value),
);

const canConfirm = computed(() => {
    if (method.value === 'CASH') return isCashSufficient.value;
    if (method.value === 'SPLIT') {
        return (
            cashGivenNum.value > 0 && referenceNumber.value.trim().length > 0
        );
    }
    return referenceNumber.value.trim().length > 0;
});

function currency(value: number): string {
    return formatCurrency(value);
}

function selectMethod(next: PaymentMethod) {
    method.value = next;
    if (next === 'CASH' && !amountTendered.value) {
        amountTendered.value = centavosToPesoInput(total.value);
    }
}

function reset() {
    method.value = props.initialMethod ?? 'CASH';
    amountTendered.value =
        props.initialCash != null ? centavosToPesoInput(props.initialCash) : '';
    splitCashGiven.value = '';
    referenceNumber.value = '';
    processing.value = false;
}

watch(
    () => props.modelValue,
    (open) => {
        if (open) reset();
    },
);

function finish() {
    if (!canConfirm.value || processing.value) return;

    processing.value = true;

    setTimeout(() => {
        let payment: PaymentInfo;

        if (method.value === 'CASH') {
            payment = {
                method: 'CASH',
                amountTendered: tenderedNum.value || total.value,
                changeDue: changeDue.value,
            };
        } else if (method.value === 'SPLIT') {
            payment = {
                method: 'SPLIT',
                referenceNumber: referenceNumber.value,
                split: {
                    cashAmount: splitCashPortion.value,
                    onlineAmount: splitOnlinePortion.value,
                    cashTendered: cashGivenNum.value,
                    cashChange: splitCashChangeDue.value,
                    referenceNumber: referenceNumber.value,
                    onlineMethod: 'GCash QR',
                },
            };
        } else {
            payment = {
                method: 'GCASH',
                referenceNumber: referenceNumber.value,
            };
        }

        processing.value = false;
        emit('complete', payment);
        model.value = false;
    }, 600);
}
</script>
