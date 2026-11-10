<template>
    <form
        role="search"
        class="flex flex-col gap-2"
        @submit.prevent="emit('search')"
    >
        <div class="flex flex-wrap items-end gap-3">
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
            <div class="contents *:min-w-40 *:flex-1 *:basis-40">
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
 */
import { useId } from 'vue';
import { Search as SearchIcon, X } from '@lucide/vue';
import BaseButton from './BaseButton.vue';
import BaseInput from './BaseInput.vue';

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
    },
);

const emit = defineEmits<{
    (e: 'update:search', value: string): void;
    (e: 'search'): void;
    (e: 'clear'): void;
}>();

const hintId = useId();
</script>
