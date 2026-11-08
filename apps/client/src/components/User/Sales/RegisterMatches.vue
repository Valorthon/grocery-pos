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
                >Click an item, or pick with ↑/↓ and press Enter</span
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
            role="listbox"
            data-testid="search-matches"
            class="grid grid-cols-1 sm:grid-cols-2 gap-2 transition-opacity"
            :class="{ 'opacity-50': !settled }"
            :aria-busy="!settled"
        >
            <button
                v-for="(m, i) in matches"
                :id="`product-match-${i}`"
                :key="m.product"
                type="button"
                role="option"
                data-testid="search-match"
                :aria-selected="i === highlighted"
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
import { AlertCircle, Search } from '@lucide/vue';
import type { Match } from '@/components/User/Sales/product-search';

defineProps<{
    matches: readonly Match[];
    highlighted: number;
    settled: boolean;
    error: string | null;
    term: string;
    locked: boolean;
}>();
const emit = defineEmits<{ select: [match: Match] }>();
</script>
