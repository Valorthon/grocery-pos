<template>
    <div class="flex flex-col gap-3">
        <div class="flex flex-wrap items-end gap-2">
            <BaseInput
                :model-value="search"
                :label="searchLabel"
                :placeholder="placeholder"
                :maxlength="maxlength"
                clearable
                class="min-w-0 flex-1 basis-60"
                @update:model-value="emit('update:search', $event)"
                @enter="emit('search')"
                @clear="emit('search')"
            />
            <BaseButton class="min-h-11" @click="emit('search')">
                <template #icon><SearchIcon :size="16" /></template>
                Search
            </BaseButton>
            <BaseButton
                v-if="$slots.default"
                variant="outline"
                class="min-h-11"
                :aria-expanded="open"
                :aria-controls="panelId"
                @click="open = !open"
            >
                <template #icon><SlidersHorizontal :size="16" /></template>
                Filters
                <span
                    v-if="chips.length"
                    class="num rounded-full bg-leaf-600 px-2 text-xs text-white"
                >
                    {{ chips.length }}<span class="sr-only"> active</span>
                </span>
            </BaseButton>
        </div>

        <div
            v-if="$slots.default"
            v-show="open"
            :id="panelId"
            class="grid grid-cols-1 gap-3 rounded-card border border-line bg-paper p-3 sm:grid-cols-2 lg:grid-cols-4"
        >
            <slot />
        </div>

        <ul
            v-if="chips.length"
            class="flex flex-wrap items-center gap-2"
            aria-label="Applied filters"
        >
            <li v-for="chip in chips" :key="chip.key">
                <button
                    type="button"
                    class="inline-flex min-h-11 items-center gap-1 rounded-full border border-leaf-200 bg-leaf-50 px-3 text-xs font-semibold text-leaf-700 hover:border-leaf-500 focus-ring"
                    :aria-label="`Remove filter ${chip.label}`"
                    @click="emit('remove', chip.key)"
                >
                    {{ chip.label }}
                    <X :size="14" aria-hidden="true" />
                </button>
            </li>
            <li v-if="chips.length > 1">
                <button
                    type="button"
                    class="min-h-11 rounded px-2 text-xs font-semibold text-muted hover:text-ink hover:underline focus-ring"
                    @click="emit('clear')"
                >
                    Clear all
                </button>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
/*
 * Presentational only (#157): the page owns its live inputs and its
 * `useAppliedFilters`/`useListPaging` state. `search` is the typed text;
 * `chips` must be built from the *applied* snapshot, so a chip never shows
 * text that was typed but not searched. `search` is emitted on Enter, the
 * Search button and the clear (×); `remove`/`clear` ask the page to reset
 * that input and call its `apply()` once. Select/date controls in the
 * default slot keep applying on change, as the page wires them.
 */
import { ref, useId } from 'vue';
import { Search as SearchIcon, SlidersHorizontal, X } from '@lucide/vue';
import BaseButton from './BaseButton.vue';
import BaseInput from './BaseInput.vue';
import type { FilterChip } from './page-primitives';

const props = withDefaults(
    defineProps<{
        search: string;
        searchLabel?: string;
        placeholder?: string;
        maxlength?: number;
        chips?: FilterChip[];
        /** Start with the Filters panel open. */
        initiallyOpen?: boolean;
    }>(),
    {
        searchLabel: 'Search',
        placeholder: undefined,
        maxlength: undefined,
        chips: () => [],
        initiallyOpen: false,
    },
);

const emit = defineEmits<{
    (e: 'update:search', value: string): void;
    (e: 'search'): void;
    (e: 'remove', key: string): void;
    (e: 'clear'): void;
}>();

const open = ref(props.initiallyOpen);
const panelId = useId();
</script>
