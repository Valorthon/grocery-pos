<template>
    <BaseModal v-model="model" max-width="28rem" scrollable>
        <template #header>
            <div class="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 class="w-4 h-4 text-emerald-600" />
                <span class="text-xs font-bold">Transaction Complete</span>
            </div>
        </template>

        <div
            class="p-4 sm:p-5 overflow-y-auto bg-slate-100 font-mono text-xs text-slate-900"
        >
            <div
                class="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-4"
            >
                <div class="text-center space-y-1">
                    <div
                        class="w-8 h-8 rounded-lg bg-slate-900 text-white font-extrabold text-sm flex items-center justify-center mx-auto"
                    >
                        G
                    </div>
                    <h3
                        class="font-bold text-sm tracking-widest text-slate-900 uppercase"
                    >
                        Grocery POS
                    </h3>
                    <p class="text-[11px] text-slate-500">
                        Store #104 • (415) 890-4100
                    </p>
                </div>

                <div
                    class="border-t border-dashed border-slate-300 pt-3 text-[11px] space-y-1 text-slate-500"
                >
                    <div class="flex justify-between">
                        <span>{{ formattedDate }}</span>
                        <span>Lane #01</span>
                    </div>
                    <div class="flex justify-between">
                        <span>Cashier: {{ receipt?.cashierName }}</span>
                        <span>Store #104</span>
                    </div>
                </div>

                <div
                    class="border-t border-dashed border-slate-300 pt-3 space-y-2"
                >
                    <div
                        class="flex justify-between font-bold text-[10px] text-slate-500 uppercase border-b border-slate-100 pb-1"
                    >
                        <span>Item</span>
                        <span>Total</span>
                    </div>
                    <div
                        v-for="(item, idx) in receipt?.items ?? []"
                        :key="idx"
                        class="flex justify-between text-xs items-start"
                    >
                        <div class="pr-2">
                            <p class="font-bold text-slate-900">
                                {{ item.productName }}
                            </p>
                            <p class="text-[10px] text-slate-400">
                                {{ item.quantity }} x
                                {{ currency(item.amount / item.quantity) }}
                            </p>
                        </div>
                        <span class="font-bold text-slate-900">{{
                            currency(item.amount)
                        }}</span>
                    </div>
                </div>

                <div
                    class="border-t border-dashed border-slate-300 pt-3 space-y-1 text-xs"
                >
                    <div class="flex justify-between text-slate-600">
                        <span>Subtotal ({{ itemCount }} Items):</span>
                        <span class="font-bold text-slate-900">{{
                            currency(receipt?.subtotal ?? 0)
                        }}</span>
                    </div>
                    <template v-if="receipt?.discount">
                        <div
                            class="flex justify-between text-emerald-700 font-bold"
                        >
                            <span>Discount ({{ discountLabel }}):</span>
                            <span
                                >-{{ currency(receipt.discount.amount) }}</span
                            >
                        </div>
                        <div class="text-[10px] text-slate-500">
                            Reason: {{ receipt.discount.reason }}
                        </div>
                    </template>
                    <div class="flex justify-between text-slate-600">
                        <span>Sales Tax (Exempt):</span>
                        <span>{{ currency(0) }}</span>
                    </div>
                    <div
                        class="flex justify-between text-sm font-black text-slate-900 pt-2 border-t border-slate-200"
                    >
                        <span>TOTAL:</span>
                        <span class="text-base font-black">{{
                            currency(receipt?.totalAmount ?? 0)
                        }}</span>
                    </div>
                </div>

                <div
                    class="border-t border-dashed border-slate-300 pt-3 space-y-1.5 text-[11px] text-slate-500"
                >
                    <div class="flex justify-between">
                        <span>Payment Method:</span>
                        <span class="font-bold text-slate-900">{{
                            methodLabel
                        }}</span>
                    </div>

                    <template v-if="payment?.split">
                        <div
                            class="flex justify-between text-slate-800 font-semibold"
                        >
                            <span>1. Cash Paid:</span>
                            <span>{{
                                currency(payment.split.cashAmount)
                            }}</span>
                        </div>
                        <div
                            class="flex justify-between text-slate-800 font-semibold"
                        >
                            <span>2. GCash Paid:</span>
                            <span>{{
                                currency(payment.split.onlineAmount)
                            }}</span>
                        </div>
                        <div
                            v-if="payment.split.cashChange > 0"
                            class="flex justify-between text-emerald-700 font-bold"
                        >
                            <span>Cash Change Given:</span>
                            <span>{{
                                currency(payment.split.cashChange)
                            }}</span>
                        </div>
                        <div
                            class="flex justify-between text-slate-500 text-[10px]"
                        >
                            <span>QR Ref Code:</span>
                            <span>#{{ payment.split.referenceNumber }}</span>
                        </div>
                    </template>
                    <template v-else>
                        <div
                            v-if="payment?.amountTendered"
                            class="flex justify-between"
                        >
                            <span>Tendered:</span>
                            <span>{{ currency(payment.amountTendered) }}</span>
                        </div>
                        <div
                            v-if="payment?.changeDue"
                            class="flex justify-between text-emerald-700 font-bold"
                        >
                            <span>Change:</span>
                            <span>{{ currency(payment.changeDue) }}</span>
                        </div>
                        <div
                            v-if="payment?.referenceNumber"
                            class="flex justify-between"
                        >
                            <span>Ref:</span>
                            <span>#{{ payment.referenceNumber }}</span>
                        </div>
                    </template>
                </div>

                <div
                    class="border-t border-dashed border-slate-300 pt-3 text-center space-y-1.5"
                >
                    <Barcode
                        class="w-40 h-8 mx-auto text-slate-800 opacity-70"
                    />
                    <p class="text-[10px] text-slate-400">
                        Thank you for shopping at Grocery POS!<br />
                        Return policy: 30 days with receipt.
                    </p>
                </div>
            </div>
        </div>

        <template #footer>
            <BaseButton variant="outline" class="flex-1" @click="printReceipt">
                <Printer class="w-3.5 h-3.5" />
                Print
            </BaseButton>
            <BaseButton class="flex-1" @click="nextSale">
                <RotateCcw class="w-3.5 h-3.5" />
                Next Sale
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Barcode, CheckCircle2, Printer, RotateCcw } from '@lucide/vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import type { PaymentInfo, Receipt } from './types';
import { formatCurrency } from '@/utils/currency';
import { DiscountType } from '@grocery-pos/contracts';

const props = defineProps<{
    modelValue: boolean;
    /** The server's receipt: its subtotal, discount and total are shown as-is. */
    receipt: Receipt | null;
    payment: PaymentInfo | null;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'new-sale'): void;
}>();

const model = computed({
    get: () => props.modelValue,
    set: (val) => emit('update:modelValue', val),
});

const itemCount = computed(
    () => props.receipt?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0,
);

const discountLabel = computed(() => {
    const discount = props.receipt?.discount;
    if (!discount) return '';
    return discount.type === DiscountType.PERCENT
        ? `${discount.value}%`
        : 'Fixed';
});

const methodLabel = computed(() => {
    switch (props.payment?.method) {
        case 'CASH':
            return 'Cash';
        case 'GCASH':
            return 'GCash (QR)';
        case 'SPLIT':
            return 'Split (Cash + GCash)';
        default:
            return '—';
    }
});

const formattedDate = computed(() =>
    new Date().toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    }),
);

function currency(value: number): string {
    return formatCurrency(value);
}

function printReceipt() {
    window.print();
}

function nextSale() {
    model.value = false;
    emit('new-sale');
}
</script>
