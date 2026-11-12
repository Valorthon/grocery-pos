<template>
    <div class="space-y-5">
        <div class="flex justify-end" data-testid="count-clear-all-row">
            <button
                type="button"
                class="inline-flex items-center min-h-11 min-w-11 px-2 text-xs font-bold text-muted hover:text-ink hover:underline underline-offset-2 disabled:opacity-40 disabled:no-underline"
                data-testid="count-clear-all"
                :disabled="!hasAnything"
                @click="clearAll"
            >
                Clear all
            </button>
        </div>

        <div v-for="group in groups" :key="group.key" class="space-y-2">
            <div
                class="flex items-center justify-between pb-1 border-b border-line"
            >
                <div
                    class="flex items-center gap-1.5 text-xs font-bold text-ink uppercase tracking-wider"
                >
                    <component
                        :is="group.icon"
                        class="w-4 h-4"
                        :class="group.iconClass"
                    />
                    <span>{{ group.title }}</span>
                </div>
                <span class="num text-xs font-bold text-muted">
                    <span
                        class="font-sans text-xs font-semibold text-muted mr-1.5"
                        :data-testid="`count-${group.key}-pieces`"
                        >{{ group.pieces }}
                        {{ group.pieces === 1 ? 'pc' : 'pcs' }} ·</span
                    >
                    <span :data-testid="`count-${group.key}-subtotal`">{{
                        formatCurrency(group.subtotal)
                    }}</span>
                </span>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <div
                    v-for="d in group.denoms"
                    :key="d.id"
                    class="p-3 rounded-card border-2 transition-all flex flex-col justify-between gap-3"
                    :class="
                        tileClass(group.kind, count(d.id) > 0, !!errors[d.id])
                    "
                >
                    <div
                        class="flex flex-col items-center justify-center gap-1.5 min-h-[92px]"
                    >
                        <div
                            class="flex items-center justify-center py-1"
                            :class="group.kind === 'bills' ? 'w-full' : ''"
                        >
                            <DenominationIcon
                                :id="d.id"
                                class="object-contain drop-shadow-md"
                                :class="
                                    group.kind === 'bills'
                                        ? 'w-full max-w-[170px] h-14'
                                        : 'w-14 h-14'
                                "
                            />
                        </div>
                        <div class="h-5 flex items-center justify-center">
                            <span
                                v-if="count(d.id) > 0"
                                class="num text-xs font-bold"
                                :class="group.subtotalClass"
                            >
                                {{ formatCurrency(count(d.id) * d.value) }}
                                <span
                                    class="text-xs font-bold"
                                    :class="group.countClass"
                                >
                                    ({{ count(d.id) }}
                                    {{ count(d.id) === 1 ? 'pc' : 'pcs' }})
                                </span>
                            </span>
                            <span v-else class="text-xs text-muted font-medium"
                                >0 pcs</span
                            >
                        </div>
                    </div>

                    <div
                        class="flex items-center justify-between gap-0.5 bg-surface border rounded-control p-0.5 shadow-2xs focus-within:outline-2"
                        :class="
                            errors[d.id]
                                ? 'border-danger-border focus-within:outline-danger-fg'
                                : 'border-line-strong focus-within:outline-leaf-500'
                        "
                    >
                        <button
                            type="button"
                            class="w-11 h-11 shrink-0 flex items-center justify-center text-muted hover:bg-leaf-50 active:bg-leaf-100 rounded-control disabled:opacity-30 text-sm font-bold transition-colors focus-ring"
                            :aria-label="`One less ${d.label} ${d.kind}`"
                            :data-testid="`count-minus-${d.id}`"
                            :disabled="count(d.id) <= 0"
                            @click="adjust(d.id, -1)"
                        >
                            <Minus class="w-4 h-4" />
                        </button>
                        <input
                            type="text"
                            inputmode="numeric"
                            autocomplete="off"
                            class="flex-1 w-full min-w-0 text-center num font-bold text-sm focus:outline-none"
                            :class="
                                errors[d.id] ? 'text-danger-fg' : 'text-ink'
                            "
                            :aria-label="`${d.label} ${d.kind} pieces`"
                            :aria-invalid="errors[d.id] ? 'true' : undefined"
                            :aria-describedby="
                                errors[d.id] ? `count-error-${d.id}` : undefined
                            "
                            :data-testid="`count-${d.id}`"
                            :value="drafts[d.id] ?? ''"
                            placeholder="0"
                            @input="set(d.id, $event)"
                        />
                        <button
                            type="button"
                            class="w-11 h-11 shrink-0 flex items-center justify-center rounded-control text-sm font-bold transition-colors disabled:opacity-30 focus-ring"
                            :class="group.plusClass"
                            :aria-label="`One more ${d.label} ${d.kind}`"
                            :data-testid="`count-plus-${d.id}`"
                            :disabled="count(d.id) >= SHIFT_LIMITS.PIECES_MAX"
                            @click="adjust(d.id, 1)"
                        >
                            <Plus class="w-4 h-4" />
                        </button>
                    </div>
                    <p
                        v-if="errors[d.id]"
                        :id="`count-error-${d.id}`"
                        class="-mt-1.5 text-xs font-semibold text-danger-fg text-center"
                        :data-testid="`count-error-${d.id}`"
                    >
                        {{ errors[d.id] }}
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, reactive, toRaw, watch } from 'vue';
import { Banknote, Coins, Minus, Plus } from '@lucide/vue';
import { type CashDenomination, SHIFT_LIMITS } from '@grocery-pos/contracts';
import DenominationIcon from './DenominationIcon.vue';
import {
    COIN_DENOMINATIONS,
    countPieces,
    PAPER_DENOMINATIONS,
    piecesError,
} from './shift';
import type { BillCounts } from './shift';
import { formatCurrency } from '@/utils/currency';

/*
 * A drawer count (issue #25). Every field is controlled: what the cashier
 * types stays in `drafts`, and each keystroke updates the counts, so the
 * subtotals and the parent's total are live. A field that is not a whole
 * number of pieces (0 to PIECES_MAX, like the API's `IsBillCounts`) is
 * flagged under it, counts as nothing, and sets `invalid` so the parent
 * refuses to submit.
 */
const props = defineProps<{
    modelValue: BillCounts;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: BillCounts): void;
}>();

/** True while any field holds something that is not a valid count. */
const invalid = defineModel<boolean>('invalid', { default: false });

const drafts = reactive<Record<string, string>>({});
const errors = reactive<Record<string, string>>({});
/** The counts this component last emitted, to tell them from a reset. */
let emitted: BillCounts | null = null;

function syncFromModel(counts: BillCounts) {
    for (const id of Object.keys(drafts)) delete drafts[id];
    for (const id of Object.keys(errors)) delete errors[id];
    for (const [id, pieces] of Object.entries(counts)) {
        if (pieces > 0) drafts[id] = String(pieces);
    }
    invalid.value = false;
}

// A new object from the parent (the reset on open) replaces whatever was
// typed; our own emits are already reflected in `drafts`.
watch(
    () => props.modelValue,
    (counts) => {
        // A parent's ref hands the counts back as a reactive proxy.
        if (toRaw(counts) !== emitted) syncFromModel(counts);
    },
    { immediate: true },
);

function subtotal(denoms: readonly CashDenomination[]): number {
    return denoms.reduce((sum, d) => sum + count(d.id) * d.value, 0);
}

function pieces(denoms: readonly CashDenomination[]): number {
    return denoms.reduce((sum, d) => sum + count(d.id), 0);
}

const groups = computed(() => [
    {
        key: 'bills',
        kind: 'bills',
        title: 'Bills',
        icon: Banknote,
        iconClass: 'text-leaf-600',
        subtotalClass: 'text-leaf-950',
        countClass: 'text-leaf-600',
        plusClass: 'text-leaf-700 hover:bg-leaf-50 active:bg-leaf-100',
        denoms: PAPER_DENOMINATIONS,
        subtotal: subtotal(PAPER_DENOMINATIONS),
        pieces: pieces(PAPER_DENOMINATIONS),
    },
    {
        key: 'coins',
        kind: 'coins',
        title: 'Coins',
        icon: Coins,
        iconClass: 'text-warning-fg',
        subtotalClass: 'text-warning-fg',
        countClass: 'text-warning-fg',
        plusClass: 'text-warning-fg hover:bg-warning-bg active:bg-citrus-100',
        denoms: COIN_DENOMINATIONS,
        subtotal: subtotal(COIN_DENOMINATIONS),
        pieces: pieces(COIN_DENOMINATIONS),
    },
]);

const hasAnything = computed(
    () =>
        countPieces(props.modelValue) > 0 ||
        Object.values(drafts).some((text) => text.trim() !== ''),
);

function count(id: string): number {
    return props.modelValue[id] ?? 0;
}

function tileClass(kind: string, active: boolean, refused: boolean): string {
    if (refused) return 'bg-danger-bg/80 border-danger-border';
    if (!active) {
        return 'bg-paper/90 border-line hover:border-line-strong';
    }
    return kind === 'bills'
        ? 'bg-leaf-50/90 border-leaf-300'
        : 'bg-warning-bg/90 border-warning-border';
}

/** Sets one denomination's pieces; 0 drops it from the counts. */
function emitCount(id: string, pieces: number) {
    const next: BillCounts = { ...props.modelValue };
    if (pieces > 0) next[id] = pieces;
    else delete next[id];
    emitted = next;
    emit('update:modelValue', next);
}

function setError(id: string, message: string) {
    if (message) errors[id] = message;
    else delete errors[id];
    invalid.value = Object.values(errors).some(Boolean);
}

function adjust(id: string, delta: number) {
    const next = Math.min(
        SHIFT_LIMITS.PIECES_MAX,
        Math.max(0, count(id) + delta),
    );
    drafts[id] = next > 0 ? String(next) : '';
    setError(id, '');
    emitCount(id, next);
}

function set(id: string, event: Event) {
    const text = (event.target as HTMLInputElement).value;
    drafts[id] = text;
    const message = piecesError(text);
    setError(id, message);
    // A refused entry counts as nothing: the totals never show a guess.
    emitCount(id, message ? 0 : Number(text.trim() || '0'));
}

function clearAll() {
    const next: BillCounts = {};
    emitted = next;
    syncFromModel(next);
    emit('update:modelValue', next);
}
</script>
