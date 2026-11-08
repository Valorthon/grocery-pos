<template>
    <form
        ref="root"
        role="search"
        class="flex flex-col gap-3"
        @submit.prevent="emit('search')"
    >
        <div class="flex flex-wrap items-end gap-2">
            <BaseInput
                v-if="searchable"
                :id="searchId"
                :model-value="search"
                :label="searchLabel"
                :aria-describedby="searchHint ? hintId : undefined"
                :placeholder="placeholder"
                :maxlength="maxlength"
                clearable
                class="min-w-0 flex-1 basis-60"
                @update:model-value="emit('update:search', $event)"
                @clear="emit('search')"
            />
            <BaseButton v-if="searchable" type="submit" class="min-h-11">
                <template #icon><SearchIcon :size="16" /></template>
                Search
            </BaseButton>
            <BaseButton
                v-if="$slots.default"
                ref="toggle"
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

        <p
            v-if="searchable && searchHint"
            :id="hintId"
            class="text-xs text-muted"
        >
            {{ searchHint }}
        </p>

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
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { Search as SearchIcon, SlidersHorizontal, X } from '@lucide/vue';
import BaseButton from './BaseButton.vue';
import BaseInput from './BaseInput.vue';
import type { FilterChip } from './page-primitives';

const props = withDefaults(
    defineProps<{
        search?: string;
        searchLabel?: string;
        placeholder?: string;
        maxlength?: number;
        /** Id of the search input, for labels and specs. */
        searchId?: string;
        /** A hint under the search row, tied to the box by aria-describedby. */
        searchHint?: string;
        chips?: FilterChip[];
        /** False on lists without a text search: only the panel and chips. */
        searchable?: boolean;
        /** Start with the Filters panel open. */
        initiallyOpen?: boolean;
    }>(),
    {
        search: '',
        searchLabel: 'Search',
        placeholder: undefined,
        maxlength: undefined,
        searchId: '',
        searchHint: '',
        chips: () => [],
        searchable: true,
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
const toggle = ref<{ $el: HTMLElement } | null>(null);
const panelCount = computed(
    () => props.chips.filter((chip) => chip.inPanel).length,
);

/*
 * Resolves once the page's chips satisfy `done`. A deep-link chip goes
 * only after the route changes, later than the next tick, so focus waits
 * for the chip to really unmount. A newer removal or unmount cancels it.
 */
let stopWaiting: (() => void) | null = null;
function chipsUntil(done: () => boolean): Promise<boolean> {
    stopWaiting?.();
    return new Promise((resolve) => {
        if (done()) return resolve(true);
        const stop = watch(
            () => props.chips,
            () => {
                if (!done()) return;
                stop();
                stopWaiting = null;
                resolve(true);
            },
        );
        stopWaiting = () => {
            stop();
            resolve(false);
        };
    });
}
onBeforeUnmount(() => stopWaiting?.());

/*
 * The focused chip unmounts once the page drops it, so focus goes to the
 * chip now in its place, else the one before, else the search box.
 */
async function removeChip(key: string, index: number) {
    emit('remove', key);
    if (!(await chipsUntil(() => !props.chips.some((c) => c.key === key))))
        return;
    await nextTick();
    const chips = root.value?.querySelectorAll<HTMLElement>('[data-chip]');
    const next = chips?.[Math.min(index, chips.length - 1)];
    (next ?? fallbackFocus())?.focus();
}

async function clearAll() {
    emit('clear');
    if (!(await chipsUntil(() => props.chips.length === 0))) return;
    await nextTick();
    fallbackFocus()?.focus();
}

/*
 * The search box; without one, the Filters toggle (a panel input may be
 * hidden while the panel is collapsed).
 */
function fallbackFocus(): HTMLElement | null {
    if (props.searchable)
        return root.value?.querySelector<HTMLInputElement>('input') ?? null;
    return toggle.value?.$el ?? null;
}
const panelId = useId();
const hintId = useId();
</script>
