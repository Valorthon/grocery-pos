<template>
    <div class="flex-1 flex flex-col overflow-hidden bg-slate-100">
        <header
            class="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-5 bg-white border-b border-slate-200 gap-4"
        >
            <div>
                <h1
                    class="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight"
                >
                    Shifts
                </h1>
                <p class="text-xs sm:text-sm text-slate-500 mt-0.5">
                    Every cashier's shifts, newest first, with their close
                    reports
                </p>
            </div>

            <BaseSelect
                v-model="statusFilter"
                class="w-40"
                :options="statusOptions"
            />
        </header>

        <div class="flex-1 overflow-y-auto p-6">
            <BaseTable
                v-model:page="page"
                v-model:items-per-page="limit"
                :headers="headers"
                :items="rows"
                :loading="loading"
                :error="loadError"
                empty-text="No shifts found"
                :items-length="totalItems"
                row-click
                @click:row="select"
                @retry="fetchShifts"
            >
                <template #cell-status="{ value }">
                    <Badge
                        :color="
                            value === ShiftStatus.OPEN ? 'success' : 'neutral'
                        "
                        >{{ value }}</Badge
                    >
                </template>
                <template #cell-overShort="{ item }">
                    <span
                        v-if="item.shift.report"
                        class="font-bold"
                        :class="overShortClass(item.shift.report)"
                        >{{ signed(item.shift.report.drawer.overShort) }}</span
                    >
                    <span v-else class="text-slate-400">—</span>
                </template>
            </BaseTable>
        </div>

        <BaseModal
            v-model="isDialogOpen"
            :title="selected?.report ? '' : 'Open Shift'"
            max-width="56rem"
            scrollable
        >
            <template v-if="selected?.report" #header>
                <span class="text-xs font-bold text-emerald-700"
                    >Shift Close Report (Z-Read)</span
                >
            </template>

            <div v-if="selected?.report" class="mx-auto max-w-md">
                <ZReadReportView :report="selected.report" />
            </div>

            <div v-else-if="selected" class="space-y-4 text-sm">
                <div class="grid grid-cols-2 gap-2 text-slate-700">
                    <span class="text-slate-500">Cashier</span>
                    <span class="font-semibold">{{
                        selected.cashierName
                    }}</span>
                    <span class="text-slate-500">Terminal</span>
                    <span>{{ selected.terminal }}</span>
                    <span class="text-slate-500">Opened</span>
                    <span>{{ formatDate(selected.openedAt) }}</span>
                    <span class="text-slate-500">Opening float</span>
                    <span>{{ formatCurrency(selected.openingFloat) }}</span>
                </div>

                <div
                    class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
                >
                    Force-close an abandoned shift: count the cash in its drawer
                    below. The report records that you closed it.
                </div>

                <BillCountInput
                    v-model="closeCounts"
                    v-model:invalid="countsInvalid"
                />

                <div
                    class="flex items-center justify-between rounded-xl bg-slate-900 p-3.5 text-white"
                >
                    <span
                        class="text-[10px] font-bold uppercase tracking-wider text-slate-400"
                        >Counted cash</span
                    >
                    <span class="font-mono text-xl font-black text-primary-300">
                        {{ formatCurrency(countedCash) }}
                    </span>
                </div>

                <p v-if="closeError" class="text-xs font-semibold text-red-600">
                    {{ closeError }}
                </p>
            </div>

            <template #footer>
                <BaseButton
                    v-if="selected && !selected.report"
                    variant="danger"
                    class="flex-1"
                    :loading="closing"
                    @click="forceClose"
                    >Force-close shift</BaseButton
                >
                <BaseButton
                    variant="outline"
                    :disabled="closing"
                    @click="isDialogOpen = false"
                    >Close</BaseButton
                >
            </template>
        </BaseModal>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
    billCountTotal,
    type BillCounts,
    type Paginated,
    type ShiftListItem,
    ShiftStatus,
    type ZReadReport,
} from '@grocery-pos/contracts';
import api from '@/axios';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import Badge from '@/components/ui/Badge.vue';
import BillCountInput from '@/components/User/Sales/BillCountInput.vue';
import { COUNTS_INVALID } from '@/components/User/Sales/shift';
import ZReadReportView from '@/components/User/Sales/ZReadReportView.vue';
import { apiErrorMessage } from '@/stores/shift';
import { Color, useUIStore } from '@/stores/ui';
import { formatCurrency } from '@/utils/currency';
import { useListFetch, useListPaging } from '@/composables/useListFetch';

/**
 * ADMIN only (issue #2): every shift, open and closed, with each closed
 * shift's stored Z-read and a force-close for open ones. CSV and fuller
 * reporting are #44.
 */
const uiStore = useUIStore();

const { page, limit, search } = useListPaging(() => fetchShifts(), 10);
const totalItems = ref(0);
const shifts = ref<ShiftListItem[]>([]);
const statusFilter = ref<string>('');

const statusOptions = [
    { label: 'All shifts', value: '' },
    { label: 'Open', value: ShiftStatus.OPEN },
    { label: 'Closed', value: ShiftStatus.CLOSED },
];

const headers = [
    { key: 'cashier', title: 'Cashier' },
    { key: 'terminal', title: 'Terminal' },
    { key: 'status', title: 'Status' },
    { key: 'opened', title: 'Opened' },
    { key: 'closed', title: 'Closed' },
    { key: 'overShort', title: 'Over / Short', align: 'right' as const },
];

const rows = computed(() =>
    shifts.value.map((shift) => ({
        id: shift._id,
        shift,
        cashier: shift.cashierName,
        terminal: shift.terminal,
        status: shift.status,
        opened: formatDate(shift.openedAt),
        closed: shift.closedAt ? formatDate(shift.closedAt) : '—',
    })),
);

function formatDate(value: string): string {
    return new Date(value).toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

function signed(value: number): string {
    return value > 0 ? `+${formatCurrency(value)}` : formatCurrency(value);
}

function overShortClass(report: ZReadReport): string {
    const v = report.drawer.overShort;
    if (v === 0) return 'text-emerald-700';
    return v > 0 ? 'text-amber-700' : 'text-rose-700';
}

const {
    loading,
    error: loadError,
    load: fetchShifts,
} = useListFetch(
    () =>
        api.get<Paginated<ShiftListItem>>('/shifts', {
            params: {
                page: page.value,
                limit: limit.value,
                ...(statusFilter.value && { status: statusFilter.value }),
            },
        }),
    (res) => {
        shifts.value = res.data.data;
        totalItems.value = res.data.totalItems;
    },
    'Could not load the shifts.',
);

fetchShifts();
watch(statusFilter, search);

const isDialogOpen = ref(false);
const selected = ref<ShiftListItem | null>(null);
const closeCounts = ref<BillCounts>({});
const countsInvalid = ref(false);
const closing = ref(false);
const closeError = ref('');
// Display only: the server adds the count up itself.
const countedCash = computed(() => billCountTotal(closeCounts.value));

function select(row: { shift: ShiftListItem }) {
    selected.value = row.shift;
    closeCounts.value = {};
    closeError.value = '';
    isDialogOpen.value = true;
}

async function forceClose() {
    const shift = selected.value;
    if (!shift || closing.value) return;
    if (countsInvalid.value) {
        closeError.value = COUNTS_INVALID;
        return;
    }
    closing.value = true;
    closeError.value = '';
    try {
        const res = await api.post<ZReadReport>(`/shifts/${shift._id}/close`, {
            counts: closeCounts.value,
        });
        selected.value = {
            ...shift,
            status: ShiftStatus.CLOSED,
            closedAt: res.data.closedAt,
            report: res.data,
        };
        uiStore.queueMessage(
            Color.SUCCESS,
            `Closed ${shift.cashierName}'s shift`,
        );
        await fetchShifts();
    } catch (err) {
        closeError.value = apiErrorMessage(err, 'Could not close the shift');
    } finally {
        closing.value = false;
    }
}
</script>
