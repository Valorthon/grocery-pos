<template>
    <div
        class="relative bg-surface rounded-card border border-line overflow-hidden shadow-card"
    >
        <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
                <caption
                    v-if="caption"
                    class="px-5 py-3 text-left text-sm text-muted"
                >
                    {{
                        caption
                    }}
                </caption>
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
                                hideClass(header.hideBelow),
                            ]"
                        >
                            <span
                                v-if="header.help"
                                class="inline-flex items-center gap-0.5"
                                data-column-help
                            >
                                {{ header.title }}
                                <InfoTooltip
                                    class="-my-3 -ml-3"
                                    :label="`About ${header.title}`"
                                    :items="
                                        typeof header.help === 'string'
                                            ? undefined
                                            : header.help
                                    "
                                    >{{
                                        typeof header.help === 'string'
                                            ? header.help
                                            : ''
                                    }}</InfoTooltip
                                >
                            </span>
                            <template v-else>{{ header.title }}</template>
                        </th>
                    </tr>
                </thead>

                <tbody class="divide-y divide-line text-xs sm:text-sm text-ink">
                    <template v-if="loading">
                        <tr v-for="i in skeletonRows" :key="`sk-${i}`">
                            <td
                                v-for="header in headers"
                                :key="header.key"
                                :class="[
                                    'py-3.5 px-5',
                                    hideClass(header.hideBelow),
                                ]"
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
                                :class="
                                    $slots.empty
                                        ? ''
                                        : 'py-16 text-center text-muted'
                                "
                            >
                                <slot v-if="$slots.empty" name="empty" />
                                <div
                                    v-else
                                    class="flex flex-col items-center gap-2"
                                >
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
                                clickable(row)
                                    ? 'cursor-pointer focus-ring'
                                    : '',
                            ]"
                            :tabindex="clickable(row) ? 0 : undefined"
                            :aria-describedby="
                                clickable(row) ? rowHintId : undefined
                            "
                            :data-row-click="clickable(row) ? '' : undefined"
                            @click="onRowClick($event, row)"
                            @keydown="onRowKeydown($event, row)"
                        >
                            <component
                                :is="header.rowHeader ? 'th' : 'td'"
                                v-for="header in headers"
                                :key="header.key"
                                :scope="header.rowHeader ? 'row' : undefined"
                                :class="[
                                    'py-3.5 px-5',
                                    header.rowHeader ? 'font-semibold' : '',
                                    alignClass(header.align),
                                    hideClass(header.hideBelow),
                                ]"
                            >
                                <slot
                                    :name="`cell-${header.key}`"
                                    :item="row"
                                    :value="cell(row, header.key)"
                                >
                                    {{ cell(row, header.key) }}
                                </slot>
                            </component>
                        </tr>
                    </template>
                </tbody>

                <!-- Totals beside real rows only, never beside a skeleton, error or empty state. -->
                <tfoot
                    v-if="$slots.footer && !loading && !error && items.length"
                    class="border-t-2 border-line-strong text-xs sm:text-sm text-ink"
                >
                    <slot name="footer" />
                </tfoot>
            </table>
            <span v-if="rowClick" :id="rowHintId" class="sr-only">{{
                rowHint
            }}</span>
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
import InfoTooltip from './InfoTooltip.vue';
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
        /** The table's `<caption>`, tied to it for assistive tech. */
        caption?: string;
        emptyText?: string;
        emptyIcon?: Component;
        /**
         * Opt-in row activation (#234): the whole row is focusable and a
         * click, Enter or Space on it emits `click:row`. Clicks and keys on
         * inner buttons, links and fields never do. The row is the open
         * target; no separate open button (#311).
         */
        rowClick?: boolean;
        /**
         * With `rowClick`, which rows open (#311): a row the viewer can't
         * open isn't clickable (its ⋯ menu says why). Default: every row.
         */
        rowClickable?: (row: T) => boolean;
        /** Screen-reader hint tied to each clickable row. */
        rowHint?: string;
        itemsLength?: number;
        page?: number;
        itemsPerPage?: number;
        itemsPerPageOptions?: number[];
        skeletonRows?: number;
    }>(),
    {
        loading: false,
        error: '',
        caption: '',
        emptyText: 'No data found',
        rowClick: false,
        rowClickable: () => true,
        rowHint: 'Press Enter to open details',
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
const rowHintId = useId();

/** Buttons, links and fields inside a row keep their own action. */
const INTERACTIVE =
    'a, button, input, select, textarea, label, summary, [role="button"], [role="link"], [contenteditable="true"]';

function fromInnerControl(event: Event): boolean {
    const target = event.target as Element | null;
    const row = event.currentTarget as Element | null;
    const hit = target?.closest?.(INTERACTIVE);
    return !!hit && hit !== row && !!row?.contains(hit);
}

function clickable(row: T): boolean {
    return props.rowClick && props.rowClickable(row);
}

function onRowClick(event: MouseEvent, row: T) {
    if (!clickable(row) || fromInnerControl(event)) return;
    emit('click:row', row);
}

function onRowKeydown(event: KeyboardEvent, row: T) {
    if (!clickable(row)) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // Only the row itself: a focused inner control handles its own keys.
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    if (event.repeat) return;
    emit('click:row', row);
}

const emit = defineEmits<{
    (e: 'update:page', value: number): void;
    (e: 'update:itemsPerPage', value: number): void;
    (e: 'click:row', row: T): void;
    (e: 'retry'): void;
}>();

defineSlots<
    {
        /** Replaces the default empty row's content, e.g. an `EmptyState`. */
        empty?: () => unknown;
        /** Rows of a `<tfoot>` (e.g. totals), shown only beside loaded rows. */
        footer?: () => unknown;
    } & Record<
        `cell-${string}`,
        (props: { item: T; value: unknown }) => unknown
    >
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

/** Full class names, so Tailwind finds them in the source. */
const HIDE_BELOW: Record<NonNullable<TableHeader['hideBelow']>, string> = {
    sm: 'hidden sm:table-cell',
    md: 'hidden md:table-cell',
    lg: 'hidden lg:table-cell',
};
function hideClass(hideBelow?: TableHeader['hideBelow']): string {
    return hideBelow ? HIDE_BELOW[hideBelow] : '';
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
