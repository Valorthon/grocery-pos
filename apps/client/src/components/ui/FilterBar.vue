<template>
    <form
        role="search"
        class="flex flex-col gap-2"
        @submit.prevent="emit('search')"
    >
        <div
            v-if="compact"
            data-filter-row
            :class="['flex flex-wrap items-center gap-2', COMPACT_HEIGHT]"
        >
            <div
                v-if="searchable"
                class="flex w-full min-w-0 gap-2 sm:w-auto sm:flex-1 sm:basis-60"
            >
                <BaseInput
                    :id="searchId"
                    :model-value="search"
                    :aria-label="searchLabel"
                    :aria-describedby="searchHint ? hintId : undefined"
                    :placeholder="placeholder ?? searchLabel"
                    :maxlength="maxlength"
                    clearable
                    class="min-w-0 flex-1"
                    @update:model-value="emit('update:search', $event)"
                    @clear="emit('search')"
                />
                <BaseButton type="submit" class="min-h-11">
                    <template #icon><SearchIcon :size="16" /></template>
                    Search
                </BaseButton>
            </div>
            <div class="contents *:min-w-36 *:flex-1 sm:*:flex-none sm:*:w-48">
                <slot />
            </div>
            <BaseButton
                v-if="$slots.more"
                variant="outline"
                class="min-h-11"
                data-more-filters
                aria-haspopup="dialog"
                :aria-expanded="moreOpen"
                @click="moreOpen = true"
            >
                <template #icon><SlidersHorizontal :size="16" /></template>
                {{ filtersCount ? `Filters · ${filtersCount}` : 'Filters' }}
            </BaseButton>
            <slot name="actions" />
            <BaseButton
                v-if="clearable"
                variant="outline"
                class="min-h-11"
                data-clear-filters
                :disabled="!active"
                @click="emit('clear')"
            >
                <template #icon><X :size="16" /></template>
                Clear Filters
            </BaseButton>
            <BaseModal
                v-if="$slots.more"
                v-model="moreOpen"
                title="Filters"
                max-width="24rem"
            >
                <div class="flex flex-col gap-3">
                    <slot name="more" />
                </div>
                <template #footer>
                    <BaseButton
                        class="ml-auto min-h-11"
                        @click="moreOpen = false"
                    >
                        Done
                    </BaseButton>
                </template>
            </BaseModal>
        </div>
        <div v-else class="flex flex-wrap items-end gap-3">
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
            <!-- #261: inputs and selects stop at 16rem; chips keep their width. -->
            <div
                class="contents *:min-w-40 *:flex-1 *:basis-40 *:max-w-64 *:data-segmented:max-w-none"
            >
                <slot />
            </div>
            <BaseButton
                v-if="clearable"
                variant="outline"
                class="ml-auto min-h-11"
                :disabled="!active"
                @click="emit('clear')"
            >
                <template #icon><X :size="16" /></template>
                Clear Filters
            </BaseButton>
        </div>

        <p
            v-if="searchable && searchHint"
            :id="hintId"
            class="text-xs text-muted"
        >
            {{ searchHint }}
        </p>
    </form>
</template>

<script setup lang="ts">
/*
 * Presentational only (#157, #215): one inline row of the search box (with
 * its Search button), the page's filters, then Clear Filters at the end.
 * The page owns its inputs and its applied state. `active` enables Clear
 * while any filter (applied, entered, a preset or a deep link) is off its
 * default; `clear` asks the page to reset and reload once. The root is a
 * `<form role="search">`: Enter and the Search button submit it once, so
 * never nest FilterBar in another form. `search` is also emitted on the
 * clear (×). Select/date controls in the slot apply as the page wires them.
 *
 * `compact` (#254): one aligned row of equal-height controls with no
 * labels above them (each control carries an aria-label): the search box
 * and Search button, the default slot (a DateRangeFilter and the main
 * filter), a "Filters · N" button opening the `more` slot in a dialog on
 * the modal stack (only when that slot is given; N is `filtersCount`, the
 * page's count of applied filters in it), the `actions` slot, then Clear.
 * Below `sm` the search takes its own line.
 */
import { ref, useId } from 'vue';
import { Search as SearchIcon, SlidersHorizontal, X } from '@lucide/vue';
import BaseButton from './BaseButton.vue';
import BaseInput from './BaseInput.vue';
import BaseModal from './BaseModal.vue';
import { COMPACT_HEIGHT } from './filter-bar';

withDefaults(
    defineProps<{
        search?: string;
        searchLabel?: string;
        placeholder?: string;
        maxlength?: number;
        /** Id of the search input, for labels and specs. */
        searchId?: string;
        /** A hint under the row, tied to the box by aria-describedby. */
        searchHint?: string;
        /** False on lists without a text search. */
        searchable?: boolean;
        /** Shows Clear Filters at the end of the row. */
        clearable?: boolean;
        /** Enables Clear Filters: some filter is off its default. */
        active?: boolean;
        /** The compact row of #254 (see above). */
        compact?: boolean;
        /** How many filters in the `more` dialog are applied. */
        filtersCount?: number;
    }>(),
    {
        search: '',
        searchLabel: 'Search',
        placeholder: undefined,
        maxlength: undefined,
        searchId: '',
        searchHint: '',
        searchable: true,
        clearable: true,
        active: false,
        compact: false,
        filtersCount: 0,
    },
);

const emit = defineEmits<{
    (e: 'update:search', value: string): void;
    (e: 'search'): void;
    (e: 'clear'): void;
}>();

const hintId = useId();
const moreOpen = ref(false);
</script>
