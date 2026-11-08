<template>
    <form
        ref="root"
        role="search"
        class="flex flex-col gap-3"
        @submit.prevent="emit('search')"
    >
        <div class="flex flex-wrap items-end gap-2">
            <BaseInput
                :model-value="search"
                :label="searchLabel"
                :placeholder="placeholder"
                :maxlength="maxlength"
                clearable
                class="min-w-0 flex-1 basis-60"
                @update:model-value="emit('update:search', $event)"
                @clear="emit('search')"
            />
            <BaseButton type="submit" class="min-h-11">
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
                    v-if="panelCount"
                    class="num rounded-full bg-leaf-600 px-2 text-xs text-white"
                >
                    {{ panelCount }}<span class="sr-only"> active</span>
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
            <li v-for="(chip, index) in chips" :key="chip.key">
                <button
                    type="button"
                    class="inline-flex min-h-11 items-center gap-1 rounded-full border border-leaf-200 bg-leaf-50 px-3 text-xs font-semibold text-leaf-700 hover:border-leaf-500 focus-ring"
                    :aria-label="`Remove filter ${chip.label}`"
                    data-chip
                    @click="removeChip(chip.key, index)"
                >
                    {{ chip.label }}
                    <X :size="14" aria-hidden="true" />
                </button>
            </li>
            <li v-if="chips.length > 1">
                <button
                    type="button"
                    class="min-h-11 rounded px-2 text-xs font-semibold text-muted hover:text-ink hover:underline focus-ring"
                    @click="clearAll"
                >
                    Clear all
                </button>
            </li>
        </ul>
    </form>
</template>

<script setup lang="ts">
/*
 * Presentational only (#157): the page owns its live inputs and its
 * `useAppliedFilters`/`useListPaging` state. `search` is the typed text;
 * `chips` must be built from the *applied* snapshot, so a chip never shows
 * text that was typed but not searched. The root is a
 * `<form role="search">`: Enter and the Search button submit it once, so
 * never nest FilterBar in another form. `search` is also emitted on the
 * clear (×); `remove`/`clear` ask the page to reset
 * that input and call its `apply()` once. Select/date controls in the
 * default slot keep applying on change, as the page wires them.
 */
import { computed, nextTick, ref, useId } from 'vue';
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
const root = ref<HTMLFormElement | null>(null);
const panelCount = computed(
    () => props.chips.filter((chip) => chip.inPanel).length,
);

/*
 * The focused chip unmounts once the page drops it, so focus goes to the
 * chip now in its place, else the one before, else the search box.
 */
async function removeChip(key: string, index: number) {
    emit('remove', key);
    await nextTick();
    const chips = root.value?.querySelectorAll<HTMLElement>('[data-chip]');
    const next = chips?.[Math.min(index, chips.length - 1)];
    (next ?? searchBox())?.focus();
}

async function clearAll() {
    emit('clear');
    await nextTick();
    searchBox()?.focus();
}

function searchBox() {
    return root.value?.querySelector<HTMLInputElement>('input') ?? null;
}
const panelId = useId();
</script>
