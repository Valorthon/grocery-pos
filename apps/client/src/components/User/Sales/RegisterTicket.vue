<template>
    <div
        class="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50 flex flex-col justify-between"
    >
        <div
            class="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col h-full"
        >
            <div
                class="px-5 py-3.5 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between"
            >
                <div class="flex items-center gap-2">
                    <ShoppingBag class="w-4 h-4 text-slate-700" />
                    <h2
                        class="text-xs sm:text-sm font-extrabold text-slate-900 uppercase tracking-wide"
                    >
                        Active Register Ticket
                    </h2>
                </div>
                <div class="flex items-center gap-3">
                    <span
                        class="bg-slate-200/80 text-slate-800 text-xs font-bold px-2.5 py-0.5 rounded-full"
                    >
                        {{ totalUnits }} Units
                    </span>
                    <button
                        v-if="items.length"
                        type="button"
                        :disabled="locked"
                        class="min-h-11 text-xs font-bold text-red-600 hover:text-red-800 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors focus-ring"
                        @click="emit('void')"
                    >
                        Void Ticket
                    </button>
                </div>
            </div>

            <div
                v-if="items.length === 0"
                class="py-20 px-6 text-center text-slate-400 flex-1 flex flex-col items-center justify-center"
            >
                <div
                    class="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 text-slate-600 flex items-center justify-center mb-3"
                >
                    <Barcode class="w-7 h-7" />
                </div>
                <h3 class="text-base font-bold text-slate-800">
                    Register Ready
                </h3>
                <p
                    class="text-xs sm:text-sm text-slate-500 max-w-sm mt-1 leading-relaxed"
                >
                    Scan a barcode, enter a EAN code, or search an item above to
                    ring up products.
                </p>
            </div>

            <div v-else class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr
                            class="border-b border-slate-200 bg-slate-50 text-slate-500 text-xs font-bold uppercase tracking-wider"
                        >
                            <th class="py-2.5 px-4 w-10 text-center">#</th>
                            <th class="py-2.5 px-4">Item Description</th>
                            <th class="py-2.5 px-4 font-mono">EAN</th>
                            <th class="py-2.5 px-4 text-right">Price</th>
                            <th class="py-2.5 px-4 text-center">Quantity</th>
                            <th class="py-2.5 px-4 text-right">Line Total</th>
                            <th class="py-2.5 px-4 text-center w-14">Void</th>
                        </tr>
                    </thead>
                    <tbody
                        class="divide-y divide-slate-100 text-slate-800 text-xs sm:text-sm"
                    >
                        <!--
                                    A line is selected by scanning it or
                                    clicking it (#23): F4 edits its
                                    quantity, Delete removes it (with Undo).
                                -->
                        <tr
                            v-for="(item, index) in items"
                            :key="item.product"
                            :ref="
                                (el) =>
                                    setLineEl(
                                        item.product,
                                        el as HTMLElement | null,
                                    )
                            "
                            tabindex="-1"
                            data-ticket-line
                            :data-product="item.product"
                            :data-testid="`ticket-line-${index}`"
                            :aria-current="
                                selectedLine === item.product
                                    ? 'true'
                                    : undefined
                            "
                            class="transition-colors outline-none focus:ring-2 focus:ring-inset focus:ring-slate-900/30"
                            :class="
                                selectedLine === item.product
                                    ? 'bg-sky-50'
                                    : 'hover:bg-slate-50/80'
                            "
                            @click="emit('line-click', item.product, $event)"
                            @focusin="emit('select', item.product)"
                            @keydown.up.self.prevent="emit('move', -1)"
                            @keydown.down.self.prevent="emit('move', 1)"
                        >
                            <td
                                class="py-3 px-4 text-center font-bold text-slate-400"
                            >
                                {{ index + 1 }}
                            </td>
                            <td class="py-3 px-4">
                                <div class="font-bold text-slate-900 text-sm">
                                    {{ item.name }}
                                </div>
                            </td>
                            <td
                                class="py-3 px-4 font-mono text-xs text-slate-500"
                            >
                                {{ item.EAN }}
                            </td>
                            <td
                                class="py-3 px-4 text-right font-medium text-slate-600"
                            >
                                {{ currency(item.unitPrice) }}/{{
                                    unitLabel(item.unit)
                                }}
                            </td>
                            <td class="py-3 px-4 text-center">
                                <div
                                    class="inline-flex items-center bg-white border border-slate-300 rounded-lg p-0.5 shadow-2xs"
                                >
                                    <button
                                        type="button"
                                        :disabled="locked"
                                        :aria-label="`One less ${item.name}`"
                                        class="w-11 h-11 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors focus-ring"
                                        @click="emit('decrement', item)"
                                    >
                                        <Minus
                                            class="w-4 h-4"
                                            aria-hidden="true"
                                        />
                                    </button>
                                    <input
                                        :ref="
                                            (el) =>
                                                setQtyEl(
                                                    item.product,
                                                    el as HTMLInputElement | null,
                                                )
                                        "
                                        type="text"
                                        :inputmode="
                                            quantityScale(item.unit) === 1000
                                                ? 'decimal'
                                                : 'numeric'
                                        "
                                        autocomplete="off"
                                        :value="
                                            qtyDrafts[item.product] ??
                                            quantityInput(
                                                item.quantity,
                                                item.unit,
                                            )
                                        "
                                        :disabled="locked"
                                        :aria-label="`Quantity of ${item.name}`"
                                        :aria-keyshortcuts="
                                            REGISTER_KEYS.LINE_QUANTITY
                                        "
                                        :aria-invalid="
                                            !!qtyErrors[item.product]
                                        "
                                        :aria-describedby="
                                            qtyErrors[item.product]
                                                ? `qty-error-${index}`
                                                : undefined
                                        "
                                        data-testid="line-quantity"
                                        class="w-14 h-11 text-center font-bold text-slate-900 text-sm rounded border focus:outline-none focus:border-slate-800"
                                        :class="
                                            qtyErrors[item.product]
                                                ? 'border-red-400 bg-red-50'
                                                : 'border-transparent'
                                        "
                                        @focus="emit('select', item.product)"
                                        @input="
                                            emit(
                                                'qty-input',
                                                item.product,
                                                $event,
                                            )
                                        "
                                        @change="
                                            emit('qty-commit', item.product)
                                        "
                                        @keydown.enter.prevent="
                                            emit('qty-enter', item.product)
                                        "
                                        @keydown.esc.prevent.stop="
                                            emit('qty-cancel', item.product)
                                        "
                                    />
                                    <button
                                        type="button"
                                        :disabled="locked"
                                        :aria-label="`One more ${item.name}`"
                                        class="w-11 h-11 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors focus-ring"
                                        @click="emit('increment', item)"
                                    >
                                        <Plus
                                            class="w-4 h-4"
                                            aria-hidden="true"
                                        />
                                    </button>
                                </div>
                                <p
                                    v-if="qtyErrors[item.product]"
                                    :id="`qty-error-${index}`"
                                    data-testid="line-quantity-error"
                                    class="mt-1 text-xs font-semibold text-red-600"
                                >
                                    {{ qtyErrors[item.product] }}
                                </p>
                            </td>
                            <td
                                class="py-3 px-4 text-right font-bold text-slate-900"
                            >
                                {{
                                    currency(
                                        quantityAmount(
                                            item.unitPrice,
                                            item.quantity,
                                            item.unit,
                                        ),
                                    )
                                }}
                            </td>
                            <td class="py-3 px-4 text-center">
                                <button
                                    type="button"
                                    :disabled="locked"
                                    :aria-label="`Remove ${item.name}`"
                                    :aria-keyshortcuts="
                                        REGISTER_KEYS.REMOVE_LINE
                                    "
                                    class="min-h-11 min-w-11 inline-flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors focus-ring"
                                    @click="emit('remove', item.product)"
                                >
                                    <Trash2
                                        class="w-4 h-4"
                                        aria-hidden="true"
                                    />
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!--
                        A removed line can be put back for a few seconds
                        (decision 2026-09-25, #23).
                    -->
            <div role="status" aria-live="polite" class="mt-auto">
                <div
                    v-if="undo"
                    data-testid="undo-bar"
                    class="m-3 p-3 rounded-xl bg-slate-900 text-white flex items-center justify-between gap-3 text-sm font-semibold"
                >
                    <span
                        >Removed {{ undo.item.quantity }}×
                        {{ undo.item.name }}</span
                    >
                    <button
                        type="button"
                        :disabled="locked"
                        class="min-h-11 px-4 py-2 rounded-lg bg-white text-slate-900 text-sm font-extrabold hover:bg-slate-100 focus-ring"
                        @click="emit('undo')"
                    >
                        Undo
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
/**
 * The register's ticket table and Undo bar (#163). Selection, typed
 * quantities and removal live in Sell.vue; this renders them and reports
 * the cashier's actions.
 */
import { Barcode, Minus, Plus, ShoppingBag, Trash2 } from '@lucide/vue';
import {
    quantityAmount,
    quantityInput,
    quantityScale,
    unitLabel,
} from '@grocery-pos/contracts';
import type { CartItem } from '@/stores/cart';
import { REGISTER_KEYS } from '@/composables/useRegisterShortcuts';
import { formatCurrency as currency } from '@/utils/currency';

defineProps<{
    items: readonly CartItem[];
    totalUnits: number;
    locked: boolean;
    selectedLine: string | null;
    qtyDrafts: Readonly<Record<string, string>>;
    qtyErrors: Readonly<Record<string, string>>;
    undo: { item: CartItem; index: number } | null;
    setLineEl: (product: string, el: HTMLElement | null) => void;
    setQtyEl: (product: string, el: HTMLInputElement | null) => void;
}>();
const emit = defineEmits<{
    void: [];
    select: [product: string];
    'line-click': [product: string, event: MouseEvent];
    move: [delta: number];
    increment: [item: CartItem];
    decrement: [item: CartItem];
    'qty-input': [product: string, event: Event];
    'qty-commit': [product: string];
    'qty-enter': [product: string];
    'qty-cancel': [product: string];
    remove: [product: string];
    undo: [];
}>();
</script>
