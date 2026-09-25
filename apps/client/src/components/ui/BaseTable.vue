<template>
    <div
        class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs"
    >
        <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
                <thead>
                    <tr
                        class="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"
                    >
                        <th
                            v-for="header in headers"
                            :key="header.key"
                            :class="['py-3 px-5', alignClass(header.align)]"
                        >
                            {{ header.title }}
                        </th>
                    </tr>
                </thead>

                <tbody class="divide-y divide-slate-100 text-xs sm:text-sm">
                    <template v-if="loading">
                        <tr v-for="i in skeletonRows" :key="`sk-${i}`">
                            <td
                                v-for="header in headers"
                                :key="header.key"
                                class="py-3.5 px-5"
                            >
                                <div
                                    class="h-4 bg-slate-100 rounded animate-pulse"
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
                                        class="text-red-400"
                                        aria-hidden="true"
                                    />
                                    <p class="font-bold text-slate-800 text-sm">
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
                                class="py-16 text-center text-slate-500"
                            >
                                <div class="flex flex-col items-center gap-2">
                                    <component
                                        :is="emptyIcon"
                                        v-if="emptyIcon"
                                        :size="32"
                                        class="text-slate-300"
                                    />
                                    <p class="font-bold text-slate-800 text-sm">
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
                                'hover:bg-slate-50/80 transition-colors',
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
                                    :value="row[header.key]"
                                >
                                    {{ row[header.key] }}
                                </slot>
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </div>

        <div
            v-if="itemsLength > 0"
            class="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-slate-100"
        >
            <div class="flex items-center gap-2 text-xs text-slate-500">
                <span>Rows per page:</span>
                <select
                    :value="itemsPerPage"
                    class="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold cursor-pointer"
                    @change="
                        emit(
                            'update:itemsPerPage',
                            Number(($event.target as HTMLSelectElement).value),
                        )
                    "
                >
                    <option
                        v-for="n in itemsPerPageOptions"
                        :key="n"
                        :value="n"
                    >
                        {{ n }}
                    </option>
                </select>
                <span>
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
                <span class="text-xs font-bold text-slate-700">
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

<script setup lang="ts">
import { computed } from 'vue';
import { AlertCircle, RotateCw } from '@lucide/vue';
import BaseButton from './BaseButton.vue';
import type { Component } from 'vue';

export interface TableHeader {
    key: string;
    title: string;
    align?: 'left' | 'right' | 'center';
    sortable?: boolean;
}

const props = withDefaults(
    defineProps<{
        headers: TableHeader[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items: any[];
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
        emptyIcon: undefined,
    },
);

const emit = defineEmits<{
    (e: 'update:page', value: number): void;
    (e: 'update:itemsPerPage', value: number): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: 'click:row', row: any): void;
    (e: 'retry'): void;
}>();

function alignClass(align?: string): string {
    switch (align) {
        case 'right':
            return 'text-right';
        case 'center':
            return 'text-center';
        default:
            return 'text-left';
    }
}

const totalPages = computed(() =>
    Math.max(1, Math.ceil(props.itemsLength / props.itemsPerPage)),
);

const rangeLabel = computed(() => {
    const start = (props.page - 1) * props.itemsPerPage + 1;
    const end = Math.min(props.page * props.itemsPerPage, props.itemsLength);
    return `${start}-${end} of ${props.itemsLength}`;
});
</script>
