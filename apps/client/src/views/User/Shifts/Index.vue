<template>
    <PageFrame
        description="Every cashier's shifts, newest first, with their close reports"
    >
        <template #actions>
            <SegmentedFilter
                v-model="statusFilter"
                label="Status"
                :options="statusOptions"
            />
        </template>
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
            row-hint="Press Enter to open the shift report"
            @click:row="select"
            @retry="fetchShifts"
        >
            <template #cell-status="{ item }"
                ><StatusBadge
                    :status="item.status"
                    :map="SHIFT_STATUS"
                    data-testid="shift-status"
            /></template>
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

        <BaseModal
            v-model="isDialogOpen"
            :title="selected?.report ? '' : 'Open Shift'"
            max-width="56rem"
            scrollable
            :closable="!closing"
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
                        class="text-xs font-bold uppercase tracking-wider text-slate-400"
                        >Counted cash</span
                    >
                    <span class="font-mono text-xl font-black text-leaf-300">
                        {{ formatCurrency(countedCash) }}
                    </span>
                </div>

                <p
                    v-if="closeError"
                    role="alert"
                    class="text-xs font-semibold text-red-600"
                    data-testid="force-close-error"
                >
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
        <ConfirmDialog :request="request" @answer="answer" />
    </PageFrame>
</template>

<script setup lang="ts">
import PageFrame from '@/components/ui/PageFrame.vue';
import { computed, ref, watch } from 'vue';
import {
    billCountTotal,
    type BillCounts,
    type CloseShiftRequest,
    type Paginated,
    type ShiftListItem,
    ShiftStatus,
    type ZReadReport,
} from '@grocery-pos/contracts';
import api from '@/axios';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import { useConfirm } from '@/composables/useConfirm';
import BaseButton from '@/components/ui/BaseButton.vue';
import SegmentedFilter from '@/components/ui/SegmentedFilter.vue';
import StatusBadge from '@/components/ui/StatusBadge.vue';
import type { StatusMap } from '@/components/ui/status-badge';
import BillCountInput from '@/components/User/Sales/BillCountInput.vue';
import { countsError } from '@/components/User/Sales/shift';
import ZReadReportView from '@/components/User/Sales/ZReadReportView.vue';
import { apiErrorMessage } from '@/stores/shift';
import { Color, useUIStore } from '@/stores/ui';
import { formatCurrency } from '@/utils/currency';
import { formatStoreDateTime } from '@/utils/datetime';
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
const statusFilter = ref<'' | ShiftStatus>('');

const statusOptions: { label: string; value: '' | ShiftStatus }[] = [
    { label: 'All shifts', value: '' },
    { label: 'Open', value: ShiftStatus.OPEN },
    { label: 'Closed', value: ShiftStatus.CLOSED },
];

const SHIFT_STATUS: StatusMap<ShiftStatus> = {
    [ShiftStatus.OPEN]: { label: 'Open', color: 'success' },
    [ShiftStatus.CLOSED]: { label: 'Closed', color: 'neutral' },
};

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
    return formatStoreDateTime(value);
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

void fetchShifts();
watch(statusFilter, search);

const { request, confirm, answer } = useConfirm();
const isDialogOpen = ref(false);
const selected = ref<ShiftListItem | null>(null);
const closeCounts = ref<BillCounts>({});
const countsInvalid = ref(false);
const closing = ref(false);
const closeError = ref('');
// Display only: the server adds the count up itself.
const countedCash = computed(() => billCountTotal(closeCounts.value));

// A changed count answers the last refusal; a new one shows on submit.
watch(closeCounts, () => {
    if (!closing.value) closeError.value = '';
});

function select(row: { shift: ShiftListItem }) {
    selected.value = row.shift;
    closeCounts.value = {};
    closeError.value = '';
    isDialogOpen.value = true;
}

async function forceClose() {
    const shift = selected.value;
    if (!shift || closing.value) return;
    const refused = countsError(closeCounts.value, countsInvalid.value);
    if (refused) {
        closeError.value = refused;
        return;
    }
    const ok = await confirm({
        title: 'Force-close shift?',
        message: `Close ${shift.cashierName}'s shift with ${formatCurrency(countedCash.value)} counted? This can't be undone: it saves their Z-read now.`,
        confirmLabel: 'Force-close',
        cancelLabel: 'Go back',
        danger: true,
    });
    if (!ok || selected.value !== shift || closing.value) return;
    closing.value = true;
    closeError.value = '';
    try {
        const res = await api.post<ZReadReport>(`/shifts/${shift._id}/close`, {
            counts: closeCounts.value,
        } satisfies CloseShiftRequest);
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
