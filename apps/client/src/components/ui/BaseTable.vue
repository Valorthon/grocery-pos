<template>
    <div
        class="bg-surface rounded-card border border-line overflow-hidden shadow-card"
    >
        <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
                <thead>
                    <tr
                        class="text-xs font-semibold uppercase tracking-wider text-muted"
                    >
                        <th
                            v-for="header in headers"
                            :key="header.key"
                            :class="[
                                'py-3 px-5 bg-paper border-b border-line',
                                alignClass(header.align),
                            ]"
                        >
                            {{ header.title }}
                        </th>
                    </tr>
                </thead>

                <tbody class="divide-y divide-line text-xs sm:text-sm text-ink">
                    <template v-if="loading">
                        <tr v-for="i in skeletonRows" :key="`sk-${i}`">
                            <td
                                v-for="header in headers"
                                :key="header.key"
                                class="py-3.5 px-5"
                            >
                                <div
                                    class="h-4 bg-line rounded animate-pulse"
                                    :style="{
                                        width: `${50 + ((i * 7) % 40)}%`,
                                    }"
                                />
                            </td>
                        </tr>
                    </template>

                    <template v-else-if="error">
                        <tr>
                            <td
                                :colspan="headers.length"
                                class="py-12 text-center"
                            >
                                <div
                                    role="alert"
                                    data-testid="table-error"
                                    class="flex flex-col items-center gap-3"
                                >
                                    <AlertCircle
                                        :size="32"
                                        class="text-danger-fg"
                                        aria-hidden="true"
                                    />
                                    <p class="font-bold text-ink text-sm">
                                        {{ error }}
                                    </p>
                                    <BaseButton
                                        variant="outline"
                                        size="sm"
                                        @click="emit('retry')"
                                    >
                                        <RotateCw class="w-4 h-4" />
                                        Retry
                                    </BaseButton>
                                </div>
                            </td>
                        </tr>
                    </template>

                    <template v-else-if="items.length === 0">
                        <tr>
                            <td
                                :colspan="headers.length"
                                class="py-16 text-center text-muted"
                            >
                                <div class="flex flex-col items-center gap-2">
                                    <component
                                        :is="emptyIcon"
                                        data-testid="table-empty-icon"
                                        :size="32"
                                        class="text-muted"
                                        aria-hidden="true"
                                    />
                                    <p class="font-bold text-ink text-sm">
                                        {{ emptyText }}
                                    </p>
                                </div>
                            </td>
                        </tr>
                    </template>

                    <template v-else>
                        <tr
                            v-for="(row, index) in items"
                            :key="row.id ?? index"
                            :class="[
                                'hover:bg-paper transition-colors',
                                rowClick ? 'cursor-pointer' : '',
                            ]"
                            @click="rowClick && emit('click:row', row)"
                        >
                            <td
                                v-for="header in headers"
                                :key="header.key"
                                :class="[
                                    'py-3.5 px-5',
                                    alignClass(header.align),
                                ]"
                            >
                                <slot
                                    :name="`cell-${header.key}`"
                                    :item="row"
                                    :value="cell(row, header.key)"
                                >
                                    {{ cell(row, header.key) }}
                                </slot>
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </div>

        <!-- No pager beside an error: its page count is from the last load. -->
        <div
            v-if="itemsLength > 0 && !error"
            class="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-line"
        >
            <div class="flex items-center gap-2 text-xs text-muted">
                <label :for="rowsPerPageId">Rows per page:</label>
                <BaseSelect
                    :id="rowsPerPageId"
                    class="w-20"
                    size="sm"
                    :model-value="itemsPerPage"
                    :options="pageSizeOptions"
                    @update:model-value="
                        emit('update:itemsPerPage', Number($event))
                    "
                />
                <span class="num">
                    {{ rangeLabel }}
                </span>
            </div>

            <div class="flex items-center gap-2">
                <BaseButton
                    variant="outline"
                    size="sm"
                    :disabled="page <= 1"
                    @click="emit('update:page', page - 1)"
                >
                    Prev
                </BaseButton>
                <span class="text-xs font-bold text-ink num">
                    Page {{ page }} / {{ totalPages }}
                </span>
                <BaseButton
                    variant="outline"
                    size="sm"
                    :disabled="page >= totalPages"
                    @click="emit('update:page', page + 1)"
                >
                    Next
                </BaseButton>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts" generic="T extends TableRow">
import { computed, useId } from 'vue';
import { AlertCircle, Inbox, RotateCw } from '@lucide/vue';
import BaseButton from './BaseButton.vue';
import BaseSelect from './BaseSelect.vue';
import type { Component } from 'vue';
import type { TableHeader, TableRow } from './types';

const props = withDefaults(
    defineProps<{
        headers: TableHeader[];
        items: T[];
        loading?: boolean;
        /**
         * Why the rows could not be loaded (issue #18): shown in their
         * place with a Retry button, which emits `retry`.
         */
        error?: string;
        emptyText?: string;
        emptyIcon?: Component;
        rowClick?: boolean;
        itemsLength?: number;
        page?: number;
        itemsPerPage?: number;
        itemsPerPageOptions?: number[];
        skeletonRows?: number;
    }>(),
    {
        loading: false,
        error: '',
        emptyText: 'No data found',
        rowClick: false,
        itemsLength: 0,
        page: 1,
        itemsPerPage: 5,
        itemsPerPageOptions: () => [5, 10, 25, 50],
        skeletonRows: 5,
        emptyIcon: () => Inbox,
    },
);

// Ties the visible "Rows per page" label to its select (#142).
const rowsPerPageId = useId();

const emit = defineEmits<{
    (e: 'update:page', value: number): void;
    (e: 'update:itemsPerPage', value: number): void;
    (e: 'click:row', row: T): void;
    (e: 'retry'): void;
}>();

defineSlots<
    Record<`cell-${string}`, (props: { item: T; value: unknown }) => unknown>
>();

/** The row's `key` field, for a cell without a slot. */
function cell(row: T, key: string): unknown {
    return (row as Record<string, unknown>)[key];
}

function alignClass(align?: string): string {
    switch (align) {
        case 'right':
            // Numbers line up by digit in a right-aligned column (#156).
            return 'text-right num';
        case 'center':
            return 'text-center';
        default:
            return 'text-left';
    }
}

const pageSizeOptions = computed(() =>
    props.itemsPerPageOptions.map((n) => ({ label: String(n), value: n })),
);

const totalPages = computed(() =>
    Math.max(1, Math.ceil(props.itemsLength / props.itemsPerPage)),
);

const rangeLabel = computed(() => {
    const start = (props.page - 1) * props.itemsPerPage + 1;
    const end = Math.min(props.page * props.itemsPerPage, props.itemsLength);
    return `${start}-${end} of ${props.itemsLength}`;
});
</script>
