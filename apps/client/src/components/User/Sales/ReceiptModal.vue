<template>
    <!--
        The dialog itself takes the focus (issue #22): a stray Enter (a
        double Enter on checkout, a scanner's trailing Enter) presses
        nothing, so the change due stays on screen. A scan typed here
        starts the next sale (see onKeydown).
    -->
    <BaseModal
        v-model="model"
        max-width="28rem"
        scrollable
        initial-focus="dialog"
    >
        <template #header>
            <div class="flex items-center gap-2 text-success-fg">
                <CheckCircle2 class="w-4 h-4 text-success-fg" />
                <span class="text-xs font-bold">Transaction Complete</span>
            </div>
        </template>

        <div
            v-if="notice"
            role="status"
            class="mx-4 sm:mx-5 mt-4 p-3 rounded-control border border-warning-border bg-warning-bg text-xs font-semibold text-warning-fg"
            data-testid="receipt-notice"
        >
            {{ notice }}
        </div>
        <div
            class="p-4 sm:p-5 overflow-y-auto bg-paper num text-xs text-ink drop-shadow-sm"
        >
            <div
                class="receipt-paper max-w-xs mx-auto bg-surface px-5 py-7 space-y-4"
                data-testid="receipt-paper"
            >
                <div class="text-center space-y-1">
                    <div
                        class="w-8 h-8 rounded-control bg-leaf-800 text-white font-bold text-sm flex items-center justify-center mx-auto"
                    >
                        {{ identity.storeName.charAt(0) || 'G' }}
                    </div>
                    <h3
                        class="font-bold text-sm tracking-widest text-ink uppercase"
                    >
                        {{ identity.storeName }}
                    </h3>
                    <p v-if="identity.branchName">{{ identity.branchName }}</p>
                    <p v-if="identity.address">{{ identity.address }}</p>
                    <p v-if="identity.contactNumber">
                        {{ identity.contactNumber }}
                    </p>
                    <p v-if="identity.tin">TIN {{ identity.tin }}</p>
                </div>

                <div
                    class="border-t border-dashed border-line-strong pt-3 text-xs space-y-1 text-muted"
                >
                    <div class="flex justify-between gap-2">
                        <time
                            :datetime="receipt?.createdAt"
                            data-testid="receipt-date"
                            >{{ formattedDate }}</time
                        >
                        <span data-testid="receipt-terminal">{{
                            identity.terminalLabel
                        }}</span>
                    </div>
                    <div class="flex justify-between gap-2">
                        <span>Cashier: {{ receipt?.cashierName }}</span>
                        <span
                            class="font-bold text-ink"
                            data-testid="receipt-sale-number"
                            >Sale #{{ number }}</span
                        >
                    </div>
                    <div
                        class="text-xs text-muted break-all text-right"
                        data-testid="receipt-sale-id"
                    >
                        ID {{ receipt?._id }}
                    </div>
                </div>

                <div
                    class="border-t border-dashed border-line-strong pt-3 space-y-2"
                >
                    <div
                        class="flex justify-between font-bold text-xs text-muted uppercase border-b border-line pb-1"
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
                            <p class="font-bold text-ink">
                                {{ item.productName }}
                            </p>
                            <p class="text-xs text-muted">
                                {{
                                    item.unit
                                        ? formatQuantity(
                                              item.quantity,
                                              item.unit,
                                          )
                                        : item.quantity
                                }}
                                x
                                {{
                                    currency(
                                        item.unitPrice ??
                                            item.amount / item.quantity,
                                    )
                                }}{{
                                    item.unit ? `/${unitLabel(item.unit)}` : ''
                                }}
                            </p>
                        </div>
                        <span class="font-bold text-ink">{{
                            currency(item.amount)
                        }}</span>
                    </div>
                </div>

                <div
                    class="border-t border-dashed border-line-strong pt-3 space-y-1 text-xs"
                >
                    <div class="flex justify-between text-muted">
                        <span
                            >Subtotal ({{ countOf(itemCount, 'Item') }}):</span
                        >
                        <span class="font-bold text-ink">{{
                            currency(receipt?.subtotal ?? 0)
                        }}</span>
                    </div>
                    <template v-if="receipt?.discount">
                        <div
                            class="flex justify-between text-success-fg font-bold"
                        >
                            <span>Discount ({{ discountLabel }}):</span>
                            <span
                                >-{{ currency(receipt.discount.amount) }}</span
                            >
                        </div>
                        <div class="text-xs text-muted">
                            Reason: {{ receipt.discount.reason }}
                        </div>
                    </template>
                    <div
                        class="flex justify-between text-sm font-bold text-ink pt-2 border-t border-line"
                    >
                        <span>TOTAL:</span>
                        <span class="text-base font-bold">{{
                            currency(receipt?.totalAmount ?? 0)
                        }}</span>
                    </div>
                </div>

                <div
                    class="border-t border-dashed border-line-strong pt-3 space-y-1.5 text-xs text-muted"
                >
                    <div class="flex justify-between">
                        <span>Payment Method:</span>
                        <span class="font-bold text-ink">{{
                            methodLabel
                        }}</span>
                    </div>

                    <div
                        v-for="tender in receipt?.tenders ?? []"
                        :key="tender.type"
                        class="flex justify-between text-ink font-semibold"
                    >
                        <span>{{ tenderLabel(tender.type) }}:</span>
                        <span>{{ currency(tender.amount) }}</span>
                    </div>
                    <div
                        v-if="receipt && hasCashTender(receipt)"
                        class="flex justify-between text-success-fg font-bold"
                        data-testid="receipt-change"
                    >
                        <span>Change:</span>
                        <span>{{ currency(receipt.changeGiven) }}</span>
                    </div>
                    <div
                        v-if="receipt?.referenceNumber"
                        class="flex justify-between"
                    >
                        <span>GCash Ref:</span>
                        <span>#{{ receipt.referenceNumber }}</span>
                    </div>
                </div>

                <div
                    class="border-t border-dashed border-line-strong pt-3 text-center space-y-1.5"
                >
                    <p class="text-xs text-muted">
                        {{ identity.receiptFooter }}
                    </p>
                    <p
                        class="text-xs font-bold text-ink"
                        data-testid="not-official-receipt"
                    >
                        This is not an official receipt.
                    </p>
                </div>
            </div>
        </div>

        <template #footer>
            <BaseButton class="flex-1" @click="nextSale">
                <RotateCcw class="w-3.5 h-3.5" />
                Next Sale
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { countOf } from '@/utils/plural';
import { storePresentation, terminalLabel } from '@/settings/presentation';
import {
    formatQuantity,
    UnitOfMeasure,
    unitLabel,
} from '@grocery-pos/contracts';
import { computed, onBeforeUnmount, watch } from 'vue';
import { CheckCircle2, RotateCcw } from '@lucide/vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import type { Receipt } from '@grocery-pos/contracts';
import { formatCurrency } from '@/utils/currency';
import { paymentLabel, tenderLabel } from './checkout';
import { receiptStoreIdentity } from '@grocery-pos/contracts';
import { formatStoreDateTime } from '@/utils/datetime';
import {
    discountLabel as receiptDiscountLabel,
    hasCashTender,
    saleNumber,
} from './receipt';

const props = defineProps<{
    modelValue: boolean;
    /** The server's receipt: its subtotal, discount and total are shown as-is. */
    receipt: Receipt | null;
    /** Shown above the receipt, e.g. when the sale was recorded earlier. */
    notice?: string | null;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'new-sale'): void;
    /** A code typed or scanned while the receipt is up; see onKeydown. */
    (e: 'scan', code: string): void;
}>();

const model = computed({
    get: () => props.modelValue,
    set: (val) => emit('update:modelValue', val),
});

const itemCount = computed(
    () =>
        props.receipt?.items.reduce(
            (sum, i) =>
                sum +
                (i.unit && i.unit !== UnitOfMeasure.PIECE ? 1 : i.quantity),
            0,
        ) ?? 0,
);

const discountLabel = computed(() =>
    props.receipt?.discount ? receiptDiscountLabel(props.receipt.discount) : '',
);

const methodLabel = computed(() =>
    props.receipt ? paymentLabel(props.receipt.paymentType) : '—',
);

// The server's time for this sale, in the store's timezone: each receipt
// shows its own sale's time, never the time it was opened (issue #24).
const identity = computed(
    () =>
        props.receipt?.storeIdentity ??
        receiptStoreIdentity(storePresentation.value, terminalLabel.value),
);
const formattedDate = computed(() =>
    formatStoreDateTime(props.receipt?.createdAt, identity.value.timezone),
);

const number = computed(() => saleNumber(props.receipt?._id));

function currency(value: number): string {
    return formatCurrency(value);
}

function nextSale() {
    model.value = false;
    emit('new-sale');
}

/**
 * The next customer's first scan while the receipt is up (product
 * decision, 2026-09-25): printable keys are collected, and the Enter that
 * ends them emits `scan` with the code; the register then starts the next
 * sale and adds it through its usual scan path, so the scan is never lost.
 * An Enter with nothing collected is left alone: on the dialog it does
 * nothing, and on a button the cashier tabbed to it presses that button.
 */
let collected = '';

function onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === 'Enter') {
        if (!collected) return;
        event.preventDefault();
        event.stopPropagation();
        const code = collected;
        collected = '';
        emit('scan', code);
    } else if (event.key === 'Backspace') {
        collected = collected.slice(0, -1);
    } else if (event.key.length === 1 && event.key !== ' ') {
        collected += event.key;
    }
}

function listen(on: boolean) {
    collected = '';
    if (on) document.addEventListener('keydown', onKeydown);
    else document.removeEventListener('keydown', onKeydown);
}

watch(() => props.modelValue, listen, { immediate: true });
onBeforeUnmount(() => listen(false));
</script>
