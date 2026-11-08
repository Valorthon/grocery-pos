<template>
    <div
        class="bg-slate-50 border-b border-slate-200 p-4 shadow-inner max-h-72 overflow-y-auto z-20"
    >
        <div class="flex items-center justify-between mb-2">
            <div
                class="flex items-center gap-1.5 text-slate-700 font-bold text-xs uppercase tracking-wider"
            >
                <Search class="w-3.5 h-3.5" />
                <span>Matching Items ({{ matches.length }})</span>
            </div>
            <span class="text-xs text-slate-500"
                >Click an item, or pick with ↑/↓ and press Enter</span
            >
        </div>

        <div
            v-if="error"
            data-testid="search-error"
            role="alert"
            class="py-3 px-3 flex items-center justify-center gap-2 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold"
        >
            <AlertCircle class="w-4 h-4 text-red-600 shrink-0" />
            <span>Couldn't search products: {{ error }}</span>
        </div>
        <div
            v-else-if="matches.length === 0"
            data-testid="search-empty"
            class="py-4 text-center text-slate-500 text-xs font-semibold"
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
                class="p-3 bg-white border rounded-xl hover:border-slate-800 hover:shadow-xs transition-all flex items-center justify-between text-left group focus-ring"
                :class="
                    i === highlighted
                        ? 'border-slate-900 ring-2 ring-slate-900/20'
                        : 'border-slate-200'
                "
                @click="emit('select', m)"
            >
                <div>
                    <h4
                        class="text-xs sm:text-sm font-bold text-slate-900 line-clamp-1"
                    >
                        {{ m.name }}
                    </h4>
                    <p class="text-xs font-mono text-slate-500 mt-0.5">
                        EAN: {{ m.EAN }}
                    </p>
                </div>
                <span
                    class="text-xs font-bold text-slate-600 group-hover:text-slate-900 pl-3 shrink-0"
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
