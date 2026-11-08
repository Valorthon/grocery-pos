<template>
    <div v-if="!isLarge" class="flex items-center justify-between px-6 pt-4">
        <h2
            class="text-base font-extrabold text-slate-900 uppercase tracking-wide"
        >
            Tender
        </h2>
        <button
            type="button"
            aria-label="Back to ticket"
            data-testid="close-tender"
            class="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors focus-ring"
            @click="emit('close')"
        >
            <X class="w-5 h-5" aria-hidden="true" />
        </button>
    </div>
    <div class="p-6 space-y-4">
        <div class="flex items-center justify-between text-xs sm:text-sm">
            <button
                type="button"
                class="min-h-11 text-slate-600 font-bold hover:text-slate-900 flex items-center gap-1.5 underline-offset-2 hover:underline focus-ring rounded"
                :aria-expanded="showDiscount"
                aria-controls="discount-options"
                :aria-keyshortcuts="REGISTER_KEYS.DISCOUNT"
                :disabled="offline"
                @click="emit('toggle-discount')"
            >
                <Percent class="w-3.5 h-3.5 text-slate-500" />
                {{
                    discountLabel
                        ? `Discount Applied (${discountLabel})`
                        : '+ Apply Discount'
                }}
                <KeyHint>{{ REGISTER_KEYS.DISCOUNT }}</KeyHint>
            </button>
            <span
                v-if="discountAmount > 0"
                class="text-emerald-600 font-extrabold text-sm"
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
            class="flex flex-wrap items-center gap-2 p-2 bg-slate-50 rounded-xl border border-slate-200"
        >
            <span class="text-xs font-bold text-slate-500">Discount:</span>
            <button
                v-for="d in discountOptions"
                :key="d"
                type="button"
                :disabled="locked"
                :aria-pressed="discountChoice === d"
                class="min-h-11 min-w-11 px-3 py-2 rounded-lg text-sm font-bold transition-colors active:scale-[0.98] focus-ring"
                :class="
                    discountChoice === d
                        ? 'bg-slate-900 text-white'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
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
                class="min-h-11 min-w-11 px-3 py-2 rounded-lg text-sm font-bold transition-colors active:scale-[0.98] focus-ring"
                :class="
                    discountChoice === DiscountType.FIXED
                        ? 'bg-slate-900 text-white'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                "
                @click="emit('apply-discount', DiscountType.FIXED)"
            >
                ₱ Amount
            </button>
        </div>

        <div v-if="discountChoice === DiscountType.FIXED" class="space-y-1">
            <label
                for="discount-amount"
                class="block text-xs font-bold text-slate-500"
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
                class="w-full min-h-11 px-3 py-2 rounded-xl border bg-white text-sm font-semibold focus:outline-none focus:border-slate-800"
                :class="fixedErrorShown ? 'border-red-300' : 'border-slate-300'"
            />
            <p
                v-if="fixedErrorShown"
                id="discount-amount-error"
                data-testid="discount-amount-error"
                class="text-xs font-semibold text-red-600"
            >
                {{ fixedErrorShown }}
            </p>
        </div>

        <div v-if="discountChoice !== 0" class="space-y-1">
            <label
                for="discount-reason"
                class="block text-xs font-bold text-slate-500"
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
                class="w-full min-h-11 px-3 py-2 rounded-xl border bg-white text-sm font-semibold focus:outline-none focus:border-slate-800"
                :class="needsReason ? 'border-red-300' : 'border-slate-300'"
            />
        </div>

        <div class="space-y-2.5 text-slate-600 text-xs sm:text-sm pt-1">
            <div class="flex justify-between font-medium">
                <span class="text-slate-500"
                    >Subtotal ({{ countOf(totalUnits, 'Item') }})</span
                >
                <span class="text-slate-900 font-bold">{{
                    currency(subtotal)
                }}</span>
            </div>
            <div
                v-if="discountAmount > 0"
                class="flex justify-between text-emerald-600 font-semibold"
            >
                <span>Discount ({{ discountLabel }})</span>
                <span>-{{ currency(discountAmount) }}</span>
            </div>
        </div>

        <div
            class="p-5 rounded-2xl bg-slate-50 border border-slate-200 shadow-2xs mt-3"
        >
            <span
                class="text-xs font-black uppercase tracking-wider text-slate-500"
            >
                Amount Due
            </span>
            <div class="flex items-baseline justify-between mt-1.5">
                <span
                    class="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight"
                >
                    {{ currency(total) }}
                </span>
                <span
                    class="text-xs font-bold text-slate-700 bg-white px-2.5 py-1 rounded-md border border-slate-200 shadow-2xs"
                >
                    {{ totalUnits }} Units
                </span>
            </div>
        </div>
    </div>

    <div class="p-6 pt-0 space-y-3">
        <button
            type="button"
            class="w-full py-3.5 px-5 bg-slate-900 hover:bg-slate-800 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-extrabold text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-xs transition-all focus-ring"
            :disabled="!canCheckout || locked"
            :aria-keyshortcuts="REGISTER_KEYS.CHARGE"
            @click="emit('checkout', PaymentType.CASH)"
        >
            <CreditCard class="w-5 h-5" />
            <span>Tender & Charge ({{ currency(total) }})</span>
            <ArrowRight class="w-4 h-4 ml-1" />
            <KeyHint tone="dark">{{ REGISTER_KEYS.CHARGE }}</KeyHint>
        </button>

        <div class="grid grid-cols-1 gap-2">
            <button
                type="button"
                class="min-h-11 py-2.5 px-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 disabled:opacity-40 flex items-center justify-center gap-1 transition-colors active:scale-[0.98] focus-ring"
                :disabled="!canCheckout || locked"
                @click="emit('checkout', PaymentType.SPLIT)"
            >
                <Split class="w-3.5 h-3.5 text-emerald-600" />
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
