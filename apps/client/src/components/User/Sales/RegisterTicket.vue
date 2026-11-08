<template>
    <div
        class="flex-1 overflow-y-auto p-4 sm:p-6 bg-paper flex flex-col justify-between"
    >
        <div
            class="bg-surface rounded-card border border-line shadow-card overflow-hidden flex flex-col h-full"
        >
            <div
                class="px-5 py-3 border-b border-line flex items-center justify-between gap-3"
            >
                <div class="flex items-center gap-2">
                    <ShoppingBag
                        class="w-4 h-4 text-leaf-600"
                        aria-hidden="true"
                    />
                    <h2
                        class="font-display text-base sm:text-lg font-bold text-ink"
                    >
                        Ticket
                    </h2>
                </div>
                <div class="flex items-center gap-3">
                    <span
                        class="num bg-leaf-50 text-leaf-700 border border-leaf-100 text-xs font-bold px-2.5 py-0.5 rounded-full"
                    >
                        {{ totalUnits }} Units
                    </span>
                    <button
                        v-if="items.length"
                        type="button"
                        :disabled="locked"
                        class="min-h-11 text-xs font-bold text-danger-fg hover:bg-danger-bg px-3 py-2 rounded-control transition-colors focus-ring disabled:opacity-40"
                        @click="emit('void')"
                    >
                        Void Ticket
                    </button>
                </div>
            </div>

            <div
                v-if="items.length === 0"
                class="py-20 px-6 text-center text-muted flex-1 flex flex-col items-center justify-center"
            >
                <div
                    class="w-14 h-14 rounded-card bg-leaf-50 border border-leaf-100 text-leaf-600 flex items-center justify-center mb-3"
                >
                    <Barcode class="w-7 h-7" aria-hidden="true" />
                </div>
                <h3 class="font-display text-lg font-bold text-ink">
                    Register Ready
                </h3>
                <p
                    class="text-xs sm:text-sm text-muted max-w-sm mt-1 leading-relaxed"
                >
                    Scan a barcode, enter a EAN code, or search an item above to
                    ring up products.
                </p>
            </div>

            <div v-else class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr
                            class="border-b border-line text-muted text-xs font-bold uppercase tracking-wider"
                        >
                            <th class="py-2.5 pl-5 pr-3">Item</th>
                            <th class="py-2.5 px-3 text-center">Quantity</th>
                            <th class="py-2.5 px-3 text-right">Line Total</th>
                            <th class="py-2.5 pl-3 pr-4 w-14">
                                <span class="sr-only">Remove</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody
                        class="divide-y divide-line text-ink text-xs sm:text-sm"
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
                            class="transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-leaf-500"
                            :class="
                                /*
                                 * The selected line (#164): a leaf tint and
                                 * a leaf bar on its leading edge.
                                 */
                                selectedLine === item.product
                                    ? 'bg-leaf-50 shadow-[inset_4px_0_0_var(--color-leaf-600)]'
                                    : 'hover:bg-paper'
                            "
                            @click="emit('line-click', item.product, $event)"
                            @focusin="emit('select', item.product)"
                            @keydown.up.self.prevent="emit('move', -1)"
                            @keydown.down.self.prevent="emit('move', 1)"
                        >
                            <td class="py-3 pl-5 pr-3" data-testid="line-item">
                                <div
                                    class="font-bold text-ink text-sm leading-snug"
                                >
                                    {{ item.name }}
                                </div>
                                <div
                                    class="mt-0.5 text-xs text-muted flex flex-wrap gap-x-2"
                                    data-testid="line-detail"
                                >
                                    <span class="num"
                                        >{{ currency(item.unitPrice) }}/{{
                                            unitLabel(item.unit)
                                        }}</span
                                    >
                                    <span class="font-mono">{{
                                        item.EAN
                                    }}</span>
                                </div>
                            </td>
                            <td class="py-3 px-3 text-center">
                                <div
                                    class="inline-flex items-center bg-surface border border-line-strong rounded-control p-0.5"
                                >
                                    <button
                                        type="button"
                                        :disabled="locked"
                                        :aria-label="`One less ${item.name}`"
                                        class="w-11 h-11 rounded flex items-center justify-center text-muted hover:bg-paper hover:text-ink transition-colors focus-ring disabled:opacity-40"
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
                                        class="num w-14 h-11 text-center font-bold text-ink text-sm rounded border focus:outline-2 focus:outline-offset-0 focus:outline-leaf-500"
                                        :class="
                                            qtyErrors[item.product]
                                                ? 'border-danger-border bg-danger-bg'
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
                                        class="w-11 h-11 rounded flex items-center justify-center text-muted hover:bg-paper hover:text-ink transition-colors focus-ring disabled:opacity-40"
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
                                    class="mt-1 text-xs font-semibold text-danger-fg"
                                >
                                    {{ qtyErrors[item.product] }}
                                </p>
                            </td>
                            <td
                                class="num py-3 px-3 text-right font-bold text-ink text-sm whitespace-nowrap"
                                data-testid="line-total"
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
                            <td class="py-3 pl-3 pr-4 text-center">
                                <button
                                    type="button"
                                    :disabled="locked"
                                    :aria-label="`Remove ${item.name}`"
                                    :aria-keyshortcuts="
                                        REGISTER_KEYS.REMOVE_LINE
                                    "
                                    class="min-h-11 min-w-11 inline-flex items-center justify-center text-muted hover:text-danger-fg hover:bg-danger-bg rounded-control transition-colors focus-ring disabled:opacity-40"
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
                    class="m-3 p-3 rounded-card bg-ink text-white flex items-center justify-between gap-3 text-sm font-semibold"
                >
                    <span
                        >Removed {{ undo.item.quantity }}×
                        {{ undo.item.name }}</span
                    >
                    <button
                        type="button"
                        :disabled="locked"
                        class="min-h-11 px-4 py-2 rounded-control bg-surface text-ink text-sm font-bold hover:bg-paper focus-ring-inverse"
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
 * The register's ticket table and Undo bar (#163). Each line shows its
 * name over a muted price/unit and EAN line, with tabular totals (#164). Selection, typed
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
