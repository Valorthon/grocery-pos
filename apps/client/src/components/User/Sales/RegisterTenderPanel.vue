<template>
    <div v-if="!isLarge" class="flex items-center justify-between px-6 pt-4">
        <h2 class="font-display text-lg font-bold text-ink">Tender</h2>
        <button
            type="button"
            aria-label="Back to ticket"
            data-testid="close-tender"
            class="min-h-11 min-w-11 flex items-center justify-center rounded-control text-muted hover:text-ink hover:bg-paper transition-colors focus-ring"
            @click="emit('close')"
        >
            <X class="w-5 h-5" aria-hidden="true" />
        </button>
    </div>
    <div class="p-6 space-y-4">
        <div class="flex items-center justify-between text-xs sm:text-sm">
            <button
                type="button"
                class="min-h-11 text-muted font-semibold hover:text-ink flex items-center gap-1.5 underline-offset-2 hover:underline focus-ring rounded disabled:opacity-40"
                :aria-expanded="showDiscount"
                aria-controls="discount-options"
                :aria-keyshortcuts="REGISTER_KEYS.DISCOUNT"
                :disabled="offline"
                @click="emit('toggle-discount')"
            >
                <Percent class="w-3.5 h-3.5" aria-hidden="true" />
                {{
                    discountLabel
                        ? `Discount Applied (${discountLabel})`
                        : '+ Apply Discount'
                }}
                <KeyHint>{{ REGISTER_KEYS.DISCOUNT }}</KeyHint>
            </button>
            <span
                v-if="discountAmount > 0"
                class="num text-success-fg font-bold text-sm"
            >
                -{{ currency(discountAmount) }}
            </span>
        </div>

        <div
            v-if="showDiscount"
            id="discount-options"
            ref="discountOptionsEl"
            role="group"
            aria-label="Discount"
            class="flex flex-wrap items-center gap-2 p-2 bg-paper rounded-card border border-line"
        >
            <span class="text-xs font-bold text-muted">Discount:</span>
            <button
                v-for="d in discountOptions"
                :key="d"
                type="button"
                :disabled="locked"
                :aria-pressed="discountChoice === d"
                class="min-h-11 min-w-11 px-3 py-2 rounded-control text-sm font-bold transition-colors active:scale-[0.98] focus-ring"
                :class="
                    discountChoice === d
                        ? 'bg-leaf-600 text-white border border-leaf-600'
                        : 'bg-surface border border-line-strong text-ink hover:bg-paper'
                "
                @click="emit('apply-discount', d)"
            >
                {{ d === 0 ? 'None' : `${d}%` }}
            </button>
            <!-- A fixed peso amount (#52 follow-up, #23). -->
            <button
                type="button"
                :disabled="locked"
                :aria-pressed="discountChoice === DiscountType.FIXED"
                class="min-h-11 min-w-11 px-3 py-2 rounded-control text-sm font-bold transition-colors active:scale-[0.98] focus-ring"
                :class="
                    discountChoice === DiscountType.FIXED
                        ? 'bg-leaf-600 text-white border border-leaf-600'
                        : 'bg-surface border border-line-strong text-ink hover:bg-paper'
                "
                @click="emit('apply-discount', DiscountType.FIXED)"
            >
                ₱ Amount
            </button>
        </div>

        <div v-if="discountChoice === DiscountType.FIXED" class="space-y-1">
            <label
                for="discount-amount"
                class="block text-xs font-bold text-muted"
                >Discount amount (₱)</label
            >
            <input
                id="discount-amount"
                ref="fixedInput"
                v-model="fixedText"
                :disabled="locked"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                placeholder="0.00"
                :aria-invalid="!!fixedErrorShown"
                :aria-describedby="
                    fixedErrorShown ? 'discount-amount-error' : undefined
                "
                class="w-full min-h-11 px-3 py-2 rounded-control border bg-surface text-sm font-semibold focus:outline-2 focus:outline-offset-0 focus:outline-leaf-500"
                :class="
                    fixedErrorShown
                        ? 'border-danger-border'
                        : 'border-line-strong'
                "
            />
            <p
                v-if="fixedErrorShown"
                id="discount-amount-error"
                data-testid="discount-amount-error"
                class="text-xs font-semibold text-danger-fg"
            >
                {{ fixedErrorShown }}
            </p>
        </div>

        <div v-if="discountChoice !== 0" class="space-y-1">
            <label
                for="discount-reason"
                class="block text-xs font-bold text-muted"
                >Discount reason (required)</label
            >
            <input
                id="discount-reason"
                ref="reasonInput"
                v-model="discountReason"
                :disabled="locked"
                type="text"
                :maxlength="STRING_LIMITS.REASON"
                placeholder="e.g. loyalty card, damaged packaging"
                class="w-full min-h-11 px-3 py-2 rounded-control border bg-surface text-sm font-semibold focus:outline-2 focus:outline-offset-0 focus:outline-leaf-500"
                :class="
                    needsReason ? 'border-danger-border' : 'border-line-strong'
                "
            />
        </div>

        <div class="space-y-2.5 text-muted text-xs sm:text-sm pt-1">
            <div class="flex justify-between font-medium">
                <span>Subtotal ({{ countOf(totalUnits, 'Item') }})</span>
                <span class="num text-ink font-bold">{{
                    currency(subtotal)
                }}</span>
            </div>
            <div
                v-if="discountAmount > 0"
                class="flex justify-between text-success-fg font-semibold"
            >
                <span>Discount ({{ discountLabel }})</span>
                <span class="num">-{{ currency(discountAmount) }}</span>
            </div>
        </div>

        <div class="p-5 rounded-card bg-leaf-50 border border-leaf-100 mt-3">
            <span
                class="text-xs font-bold uppercase tracking-wider text-leaf-700"
            >
                Amount Due
            </span>
            <div
                class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 mt-1.5"
            >
                <!--
                    The big figure in the display face (#164, #175). It wraps
                    under the badge rather than overflow; up to
                    ₱10,000,000.00 fits the 320px sheet and the 400px panel.
                -->
                <span
                    data-testid="amount-due"
                    class="min-w-0 font-display num text-2xl min-[360px]:text-3xl sm:text-4xl font-[800] text-ink tracking-tight"
                >
                    {{ currency(total) }}
                </span>
                <span
                    class="num text-xs font-bold text-leaf-700 bg-surface px-2.5 py-1 rounded-control border border-leaf-100"
                >
                    {{ totalUnits }} Units
                </span>
            </div>
        </div>
    </div>

    <div class="p-6 pt-0 space-y-3">
        <button
            type="button"
            data-testid="charge"
            class="w-full min-h-14 py-3.5 px-5 bg-citrus-500 hover:bg-citrus-400 active:bg-citrus-600 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-ink rounded-card font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-card transition-all focus-ring"
            :disabled="!canCheckout || locked"
            :aria-keyshortcuts="REGISTER_KEYS.CHARGE"
            @click="emit('checkout', PaymentType.CASH)"
        >
            <CreditCard class="w-5 h-5" aria-hidden="true" />
            <span class="num">Tender & Charge ({{ currency(total) }})</span>
            <ArrowRight class="w-4 h-4 ml-1" aria-hidden="true" />
            <KeyHint>{{ REGISTER_KEYS.CHARGE }}</KeyHint>
        </button>

        <div class="grid grid-cols-1 gap-2">
            <button
                type="button"
                class="min-h-11 py-2.5 px-2 bg-surface hover:bg-paper border border-line-strong rounded-control text-xs font-bold text-ink disabled:opacity-40 flex items-center justify-center gap-1 transition-colors active:scale-[0.98] focus-ring"
                :disabled="!canCheckout || locked"
                @click="emit('checkout', PaymentType.SPLIT)"
            >
                <Split class="w-3.5 h-3.5 text-leaf-600" aria-hidden="true" />
                <span>Split Payment</span>
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
/**
 * The tender panel's content (#163): discount, totals and the charge
 * buttons. Sell.vue owns the panel element, its sheet (useTenderSheet) and
 * all state; the fields are exposed for its focus moves (F8, F9).
 */
import { useTemplateRef } from 'vue';
import { ArrowRight, CreditCard, Percent, Split, X } from '@lucide/vue';
import {
    DiscountType,
    PaymentType,
    STRING_LIMITS,
} from '@grocery-pos/contracts';
import KeyHint from '@/components/ui/KeyHint.vue';
import { REGISTER_KEYS } from '@/composables/useRegisterShortcuts';
import { formatCurrency as currency } from '@/utils/currency';
import { countOf } from '@/utils/plural';

defineProps<{
    isLarge: boolean;
    locked: boolean;
    offline: boolean;
    showDiscount: boolean;
    discountOptions: readonly number[];
    discountChoice: number | DiscountType.FIXED;
    discountLabel: string;
    discountAmount: number;
    fixedErrorShown: string;
    needsReason: boolean;
    totalUnits: number;
    subtotal: number;
    total: number;
    canCheckout: boolean;
}>();
const fixedText = defineModel<string>('fixedText', { required: true });
const discountReason = defineModel<string>('discountReason', {
    required: true,
});
const emit = defineEmits<{
    close: [];
    'toggle-discount': [];
    'apply-discount': [choice: number | DiscountType.FIXED];
    checkout: [method: PaymentType];
}>();

const discountOptionsEl = useTemplateRef<HTMLElement>('discountOptionsEl');
const fixedInput = useTemplateRef<HTMLInputElement>('fixedInput');
const reasonInput = useTemplateRef<HTMLInputElement>('reasonInput');
defineExpose({ discountOptionsEl, fixedInput, reasonInput });
</script>
