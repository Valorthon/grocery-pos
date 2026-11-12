<template>
    <div
        class="bg-paper border-b border-line p-4 max-h-72 overflow-y-auto z-20"
    >
        <div class="flex items-center justify-between mb-2">
            <div
                class="flex items-center gap-1.5 text-muted font-bold text-xs uppercase tracking-wider"
            >
                <Search class="w-3.5 h-3.5" aria-hidden="true" />
                <span>Matching Items ({{ matches.length }})</span>
            </div>
            <span class="text-xs text-muted"
                >Click an item, or press ↓, move with the arrow keys and press
                Enter</span
            >
        </div>

        <div
            v-if="error"
            data-testid="search-error"
            role="alert"
            class="py-3 px-3 flex items-center justify-center gap-2 rounded-card bg-danger-bg border border-danger-border text-danger-fg text-xs font-semibold"
        >
            <AlertCircle class="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Couldn't search products: {{ error }}</span>
        </div>
        <div
            v-else-if="matches.length === 0"
            data-testid="search-empty"
            class="py-4 text-center text-muted text-xs font-semibold"
        >
            <template v-if="settled">
                No item matching "{{ term }}". Check barcode number or search by
                name.
            </template>
            <template v-else>Searching…</template>
        </div>
        <div
            v-else
            id="product-matches"
            ref="listbox"
            role="listbox"
            aria-label="Matching items"
            data-testid="search-matches"
            class="grid grid-cols-1 sm:grid-cols-2 gap-2 transition-opacity"
            :class="{ 'opacity-50': !settled }"
            :aria-busy="!settled"
            @keydown="onKeydown"
            @focusin="onFocusin"
            @focusout="onFocusout"
        >
            <button
                v-for="(m, i) in matches"
                :id="`product-match-${i}`"
                :key="m.product"
                type="button"
                role="option"
                data-testid="search-match"
                :aria-selected="i === highlighted"
                :tabindex="i === Math.max(highlighted, 0) ? 0 : -1"
                :data-index="i"
                :data-product="m.product"
                :disabled="locked"
                class="min-h-11 p-3 border rounded-card hover:border-leaf-600 transition-all flex items-center justify-between text-left group focus-ring"
                :class="
                    i === highlighted
                        ? 'border-leaf-600 bg-leaf-50 shadow-[inset_4px_0_0_var(--color-leaf-600)]'
                        : 'border-line bg-surface'
                "
                @click="emit('select', m)"
            >
                <div>
                    <h4
                        class="text-xs sm:text-sm font-bold text-ink line-clamp-1"
                    >
                        {{ m.name }}
                    </h4>
                    <p class="text-xs font-mono text-muted mt-0.5">
                        EAN: {{ m.EAN }}
                    </p>
                </div>
                <span
                    class="text-xs font-bold text-leaf-700 group-hover:text-leaf-800 pl-3 shrink-0"
                >
                    Add
                </span>
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
/** The register's live product matches under the scan box (#163). */
import { useTemplateRef, watch } from 'vue';
import { AlertCircle, Search } from '@lucide/vue';
import type { Match } from '@/components/User/Sales/product-search';

const props = defineProps<{
    matches: readonly Match[];
    highlighted: number;
    settled: boolean;
    error: string | null;
    term: string;
    locked: boolean;
}>();
const emit = defineEmits<{
    select: [match: Match];
    /** The focused option's index, or -1 when the focus left the list. */
    highlight: [index: number];
    /** Back to the scan box: Escape, or ↑ from the top row. */
    exit: [];
}>();

const listbox = useTemplateRef<HTMLElement>('listbox');

function options(): HTMLButtonElement[] {
    return [
        ...(listbox.value?.querySelectorAll<HTMLButtonElement>(
            '[role="option"]',
        ) ?? []),
    ];
}

/**
 * How many columns the grid renders now (2 from sm, 1 below), read from
 * the layout, so a changed breakpoint needs no change here.
 */
function columnCount(): number {
    const el = listbox.value;
    if (!el) return 1;
    const tracks = getComputedStyle(el)
        .gridTemplateColumns.trim()
        .split(/\s+/)
        .filter((t) => t && t !== 'none');
    return Math.max(tracks.length, 1);
}

/** Moves the real focus to option `index` (roving tabindex, #322). */
function focusOption(index: number) {
    if (!props.settled) return;
    const target = options()[index];
    if (!target) return;
    target.focus();
    target.scrollIntoView?.({ block: 'nearest' });
}

function indexOf(el: EventTarget | null): number {
    if (!(el instanceof HTMLElement)) return -1;
    const option = el.closest<HTMLElement>('[role="option"]');
    return option ? Number(option.dataset.index) : -1;
}

/**
 * The arrow keys move in their visual direction through the rendered
 * grid, never wrapping; ↑ from the top row and Escape go back to the scan
 * box (#322). Enter and Space add the focused match, like a click.
 */
function onKeydown(event: KeyboardEvent) {
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
        return;
    }
    const from = indexOf(event.target);
    if (from < 0) return;
    // A list for older text: no moving or picking in it (#322 review).
    if (!props.settled) {
        if (event.key === 'Escape') {
            event.preventDefault();
            emit('exit');
        } else if (/^(Arrow|Enter$| $)/.test(event.key)) {
            event.preventDefault();
        }
        return;
    }
    const count = props.matches.length;
    const cols = columnCount();
    const col = from % cols;
    let to = from;
    switch (event.key) {
        case 'ArrowRight':
            if (col < cols - 1 && from + 1 < count) to = from + 1;
            break;
        case 'ArrowLeft':
            if (col > 0) to = from - 1;
            break;
        case 'ArrowDown':
            if (from + cols < count) to = from + cols;
            break;
        case 'ArrowUp':
            if (from - cols < 0) {
                event.preventDefault();
                emit('exit');
                return;
            }
            to = from - cols;
            break;
        case 'Escape':
            event.preventDefault();
            emit('exit');
            return;
        case 'Enter':
        case ' ':
            // Exactly a click; handled here so a held key adds once.
            event.preventDefault();
            if (event.repeat || props.locked) return;
            if (props.matches[from]) emit('select', props.matches[from]);
            return;
        default:
            return;
    }
    event.preventDefault();
    if (to !== from) focusOption(to);
}

function onFocusin(event: FocusEvent) {
    const index = indexOf(event.target);
    if (index >= 0) emit('highlight', index);
}

function onFocusout(event: FocusEvent) {
    const next = event.relatedTarget;
    if (next instanceof Node && listbox.value?.contains(next)) return;
    emit('highlight', -1);
}

/**
 * The list re-rendered (new matches, or settled/unsettled) while the
 * focus was in it: keep the highlight on the option that has the focus,
 * or, when that option went away, put the focus back on the box rather
 * than letting it drop to the page (#322 review).
 */
let focusedProduct: string | null = null;
watch(
    () => [props.matches, props.settled] as const,
    () => {
        const active = document.activeElement;
        focusedProduct =
            active instanceof HTMLElement && listbox.value?.contains(active)
                ? (active.closest<HTMLElement>('[role="option"]')?.dataset
                      .product ?? null)
                : null;
    },
    { flush: 'pre' },
);
watch(
    () => [props.matches, props.settled] as const,
    () => {
        const product = focusedProduct;
        if (product === null) return;
        focusedProduct = null;
        // A moved node loses the focus in the browser: put it back.
        const index = props.settled
            ? props.matches.findIndex((m) => m.product === product)
            : -1;
        if (index < 0) {
            emit('exit');
            return;
        }
        focusOption(index);
        emit('highlight', index);
    },
    { flush: 'post' },
);

defineExpose({ focusOption });
</script>
