<template>
    <!-- The seller layout's main does not scroll; the admin one does. -->
    <div
        :class="
            inSellerLayout ? 'flex-1 min-h-0 overflow-y-auto p-4 sm:p-6' : ''
        "
    >
        <PageFrame description="View transaction history">
            <template #actions>
                <div
                    class="bg-slate-50 border border-slate-200 px-3.5 py-1.5 rounded-xl text-right"
                >
                    <span
                        class="text-xs font-bold uppercase tracking-wider text-slate-500"
                        >Transactions</span
                    >
                    <p class="text-base font-extrabold text-slate-900">
                        {{ totalItems }}
                    </p>
                </div>
                <BaseButton
                    v-if="canSell"
                    @click="router.push({ name: 'Sell' })"
                >
                    <Plus class="w-4 h-4" />
                    New Sale
                </BaseButton>
            </template>
            <FilterBar
                v-model:search="filters.saleNumber"
                search-id="sales-number"
                search-label="Sale number or full ID"
                :maxlength="24"
                :chips="chips"
                :initially-open="chips.some((chip) => chip.inPanel)"
                class="mb-4"
                @search="applyFilters"
                @remove="removeFilter"
                @clear="clearFilters"
            >
                <BaseInput
                    id="sales-from"
                    v-model="filters.dateFrom"
                    label="From"
                    type="date"
                    @change="applyFilters"
                />
                <BaseInput
                    id="sales-to"
                    v-model="filters.dateTo"
                    label="To (inclusive)"
                    type="date"
                    @change="applyFilters"
                />
                <BaseSelect
                    id="sales-payment"
                    v-model="filters.paymentType"
                    label="Payment"
                    all-label="All payments"
                    :options="
                        Object.values(PaymentType).map((value) => ({
                            label: value,
                            value,
                        }))
                    "
                    @update:model-value="applyFilters"
                />
                <BaseSelect
                    v-if="authStore.isAdmin"
                    id="sales-cashier"
                    v-model="filters.cashier"
                    label="Cashier"
                    all-label="All cashiers"
                    :options="
                        cashiers.map((row) => ({
                            label: row.name,
                            value: row._id,
                        }))
                    "
                    @update:model-value="applyFilters"
                />
                <BaseSelect
                    v-if="authStore.isAdmin"
                    id="sales-category"
                    v-model="filters.category"
                    label="Category"
                    all-label="All categories"
                    :options="
                        categories.map((row) => ({
                            label:
                                row.name + (row.isActive ? '' : ' (archived)'),
                            value: row._id,
                        }))
                    "
                    @update:model-value="applyFilters"
                />
                <div class="flex items-end">
                    <BaseButton
                        variant="outline"
                        class="min-h-11"
                        @click="clearFilters"
                        >Clear Filters</BaseButton
                    >
                </div>
            </FilterBar>
            <p
                v-if="filterError"
                role="alert"
                class="mb-3 text-sm text-red-700"
            >
                {{ filterError }}
                <BaseButton variant="outline" @click="refreshLookups"
                    >Retry filters</BaseButton
                >
            </p>
            <p
                v-if="searchError"
                role="alert"
                class="mb-3 text-sm text-red-700"
            >
                {{ searchError }}
            </p>
            <BaseTable
                v-model:page="page"
                v-model:items-per-page="limit"
                :headers="headers"
                :items="serverItems"
                :loading="loading"
                :error="loadError"
                empty-text="No orders found"
                :items-length="totalItems"
                row-click
                @click:row="showDetails"
                @retry="fetchSales"
            >
                <template #cell-amount="{ value }">
                    <span class="font-bold">{{ value }}</span>
                </template>
                <template #cell-paymentType="{ value }">
                    <Badge
                        :color="value === PaymentType.CASH ? 'success' : 'info'"
                        >{{ value }}</Badge
                    >
                </template>
                <template #cell-status="{ item, value }">
                    <Badge :color="statusColor(item.status)">{{ value }}</Badge>
                </template>
            </BaseTable>

            <BaseModal
                v-model="isDialogOpen"
                title="Sale Details"
                max-width="36rem"
                scrollable
                :closable="!reversing"
            >
                <p class="mb-3 text-sm font-bold" data-testid="sale-full-id">
                    Sale #{{ saleNumber(selectedId) }} · {{ selectedId }}
                </p>
                <p
                    v-if="selectedSale?.offline"
                    class="text-sm mb-3 text-amber-900"
                >
                    Offline cash sale · occurred {{ selectedSale.soldAt }}.
                    <strong v-if="selectedSale.stockShortfall"
                        >Stock shortfall — reconcile inventory.</strong
                    >
                    <span v-if="selectedSale.lateOffline"
                        >Admin-recorded after shift close; shown as a separate
                        closing-report addendum.</span
                    >
                </p>
                <div data-testid="details-table">
                    <BaseTable
                        :headers="detailHeaders"
                        :items="details"
                        :loading="detailsLoading"
                        :error="detailsError"
                        :skeleton-rows="2"
                        empty-text="No lines on this sale"
                        @retry="loadDetails"
                    >
                        <template #cell-product="{ item }">{{
                            item.product?.name ?? 'N/A'
                        }}</template>
                        <template #cell-qty="{ item }">{{
                            item.unit
                                ? formatQuantity(item.quantity, item.unit)
                                : item.quantity
                        }}</template>
                        <template #cell-unitPrice="{ item }">{{
                            formatCurrency(item.unitPrice ?? 0)
                        }}</template>
                        <template #cell-total="{ item }">{{
                            formatCurrency(
                                quantityAmount(
                                    item.unitPrice ?? 0,
                                    item.quantity,
                                    item.unit,
                                ),
                            )
                        }}</template>
                        <template v-if="selectedSale?.discount" #footer>
                            <tr>
                                <td colspan="3" class="py-2 px-5 text-muted">
                                    Subtotal
                                </td>
                                <td class="py-2 px-5 text-right num">
                                    {{
                                        formatCurrency(
                                            selectedSale.amount +
                                                selectedSale.discount.amount,
                                        )
                                    }}
                                </td>
                            </tr>
                            <tr class="text-success-fg">
                                <td colspan="3" class="py-2 px-5">
                                    Discount ({{
                                        discountLabel(selectedSale.discount)
                                    }}) &mdash;
                                    {{ selectedSale.discount.reason }}
                                </td>
                                <td class="py-2 px-5 text-right num">
                                    -{{
                                        formatCurrency(
                                            selectedSale.discount.amount,
                                        )
                                    }}
                                </td>
                            </tr>
                        </template>
                    </BaseTable>
                </div>
                <!-- From the list row, so it stays visible when the lines fail to load. -->
                <p
                    v-if="!detailsLoading && selectedSale"
                    data-testid="details-total"
                    class="mt-3 flex justify-between px-5 text-sm font-bold text-ink"
                >
                    <span>Total charged</span>
                    <span class="num">{{
                        formatCurrency(selectedSale.amount)
                    }}</span>
                </p>

                <div
                    v-if="selectedSale"
                    class="mt-4 space-y-1 border-t border-slate-200 pt-3 text-sm"
                >
                    <div class="flex justify-between">
                        <span class="text-slate-500">Status</span>
                        <Badge :color="statusColor(selectedSale.status)">{{
                            selectedSale.status
                        }}</Badge>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-slate-500">Payment</span>
                        <span class="font-semibold">{{
                            paymentLabel(selectedSale.paymentType)
                        }}</span>
                    </div>
                    <div
                        v-for="tender in selectedSale.tenders"
                        :key="tender.type"
                        class="flex justify-between"
                    >
                        <span class="text-slate-500">{{
                            tenderLabel(tender.type)
                        }}</span>
                        <span>{{ formatCurrency(tender.amount) }}</span>
                    </div>
                    <div
                        v-if="selectedSale.changeGiven"
                        class="flex justify-between"
                    >
                        <span class="text-slate-500">Change</span>
                        <span>{{
                            formatCurrency(selectedSale.changeGiven)
                        }}</span>
                    </div>
                    <div
                        v-if="selectedSale.referenceNumber"
                        class="flex justify-between"
                    >
                        <span class="text-slate-500">GCash Ref</span>
                        <span class="font-mono"
                            >#{{ selectedSale.referenceNumber }}</span
                        >
                    </div>
                    <div
                        v-if="selectedSale.reversal"
                        class="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800"
                    >
                        {{ reversalLabel(selectedSale.reversal.type) }} on
                        {{ formatDate(selectedSale.reversal.at) }}:
                        {{ selectedSale.reversal.reason }}
                        <template v-if="selectedSale.reversal.payoutAmount">
                            ({{
                                formatCurrency(
                                    selectedSale.reversal.payoutAmount,
                                )
                            }}
                            cash paid back)
                        </template>
                    </div>
                </div>

                <div
                    v-if="pendingReversal && selectedSale"
                    class="mt-4 space-y-2 rounded-xl border border-red-200 bg-red-50 p-3"
                >
                    <p class="text-sm font-bold text-red-800">
                        {{ reversalLabel(pendingReversal) }} this sale of
                        {{ formatCurrency(selectedSale.amount) }}?
                    </p>
                    <p class="text-xs text-red-700">
                        Every item goes back into stock and the sale no longer
                        counts toward revenue. This cannot be undone.
                    </p>
                    <p
                        v-if="reversalCash === 0"
                        class="text-xs text-red-700"
                        data-testid="payout-none"
                    >
                        No cash is paid back: the sale was paid by GCash.
                    </p>
                    <p
                        v-else-if="loadingShifts"
                        class="text-xs text-red-700"
                        data-testid="payout-loading"
                    >
                        Checking open shifts…
                    </p>
                    <div
                        v-else-if="shiftsError"
                        role="alert"
                        class="flex flex-wrap items-center gap-2 text-xs font-bold text-red-800"
                        data-testid="payout-shifts-error"
                    >
                        <span class="flex-1"
                            >Could not load open shifts: {{ shiftsError }}</span
                        >
                        <BaseButton
                            variant="outline"
                            size="sm"
                            @click="loadPayoutShifts(payoutRequired)"
                            >Retry</BaseButton
                        >
                    </div>
                    <p
                        v-else-if="!payoutRequired"
                        class="text-xs text-red-700"
                        data-testid="payout-own-shift"
                    >
                        {{ formatCurrency(reversalCash) }} cash is paid back out
                        of the drawer of the shift this sale was rung in.
                    </p>
                    <template v-else>
                        <p
                            v-if="openShifts.length === 0"
                            class="text-xs font-bold text-red-800"
                            data-testid="payout-no-open-shift"
                        >
                            {{ formatCurrency(reversalCash) }} cash must be paid
                            back, but no shift is open to pay it from. Open a
                            shift first.
                        </p>
                        <BaseSelect
                            v-else
                            id="payout-shift"
                            v-model="payoutShiftId"
                            :label="`Pay ${formatCurrency(reversalCash)} back from`"
                            :options="payoutOptions"
                            data-testid="payout-shift"
                        />
                    </template>
                    <label
                        class="block text-xs font-bold uppercase tracking-wider text-slate-600"
                        for="reversal-reason"
                        >Reason</label
                    >
                    <input
                        id="reversal-reason"
                        v-model="reversalReason"
                        type="text"
                        :maxlength="STRING_LIMITS.REASON"
                        :placeholder="
                            pendingReversal === ReversalType.VOID
                                ? 'e.g. rang up twice'
                                : 'e.g. customer returned the items'
                        "
                        class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                    />
                </div>

                <template #footer>
                    <template v-if="pendingReversal">
                        <BaseButton
                            variant="outline"
                            :disabled="reversing"
                            @click="cancelReversal"
                            >Cancel</BaseButton
                        >
                        <BaseButton
                            variant="danger"
                            class="flex-1"
                            :loading="reversing"
                            :disabled="!canConfirmReversal"
                            @click="confirmReversal"
                            >Confirm
                            {{
                                reversalLabel(pendingReversal).toLowerCase()
                            }}</BaseButton
                        >
                    </template>
                    <template v-else>
                        <template v-if="canReverse">
                            <BaseButton
                                variant="outline"
                                @click="startReversal(ReversalType.VOID)"
                                >Void sale</BaseButton
                            >
                            <BaseButton
                                variant="outline"
                                @click="startReversal(ReversalType.REFUND)"
                                >Refund sale</BaseButton
                            >
                        </template>
                        <BaseButton
                            variant="outline"
                            @click="isDialogOpen = false"
                            >Close</BaseButton
                        >
                    </template>
                </template>
            </BaseModal>
        </PageFrame>
    </div>
    <ManagerOverrideDialog
        v-model="isApprovalOpen"
        :request="approvalRequest"
        :summary="approvalSummary"
        @approved="completeApproval"
        @cancel="cancelApproval"
    />
</template>

<script setup lang="ts">
import { formatQuantity, quantityAmount } from '@grocery-pos/contracts';
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageFrame from '@/components/ui/PageFrame.vue';
import { Plus } from '@lucide/vue';
import api from '@/axios';
import { useOfflineStore } from '@/stores/offline';
import ManagerOverrideDialog from '@/components/User/Sales/ManagerOverrideDialog.vue';
import { useManagerApproval } from '@/composables/useManagerApproval';

import BaseTable from '@/components/ui/BaseTable.vue';
import type { TableHeader } from '@/components/ui/types';
import BaseInput from '@/components/ui/BaseInput.vue';
import FilterBar from '@/components/ui/FilterBar.vue';
import type { FilterChip } from '@/components/ui/page-primitives';
import { useSalesLookups } from '@/composables/useSalesLookups';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import Badge from '@/components/ui/Badge.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import { formatCurrency } from '@/utils/currency';
import { dateRangeError } from '@/utils/rules';
import { saleNumber } from '@/components/User/Sales/receipt';
import { formatStoreDateTime } from '@/utils/datetime';
import {
    apiErrorCode,
    apiErrorMessages,
    apiErrorText,
} from '@/utils/api-error';
import { useListFetch, useListPaging } from '@/composables/useListFetch';
import {
    REPORT_LIMITS,
    DiscountType,
    ErrorCode,
    OverrideAction,
    type Paginated,
    PaymentType,
    type ReceiptDiscount,
    ReversalType,
    type ReverseSaleRequest,
    Role,
    type SaleLine,
    type SaleReversalView,
    type SaleRow,
    saleNetCash,
    SaleStatus,
    type ShiftListItem,
    ShiftStatus,
    STRING_LIMITS,
    type Tender,
} from '@grocery-pos/contracts';
import { paymentLabel, tenderLabel } from '@/components/User/Sales/checkout';
import { useAuthStore } from '@/stores/auth';
import { Color, useUIStore } from '@/stores/ui';

/** The ledger fields of a sale that explain its total (centavos). */
interface SaleTotals {
    offline?: boolean;
    soldAt?: string;
    stockShortfall?: boolean;
    lateOffline?: boolean;
    amount: number;
    discount: ReceiptDiscount | null;
    status: SaleStatus;
    paymentType: PaymentType;
    /** Empty for sales recorded before tenders were stored. */
    tenders: Tender[];
    changeGiven: number;
    referenceNumber: string | null;
    reversal: SaleReversalView | null;
    /** The shift the sale was rung in; null for sales from before shifts. */
    shift: string | null;
}

/** A row of the sales table. */
interface SaleListRow {
    id: string;
    saleNumber: string;
    cashier: string;
    /** Formatted. */
    amount: string;
    totals: SaleTotals;
    paymentType: PaymentType;
    status: SaleStatus;
    /** Formatted in the store timezone. */
    date: string;
}

const authStore = useAuthStore();
const {
    isApprovalOpen,
    approvalRequest,
    approvalSummary,
    requestApproval,
    completeApproval,
    cancelApproval,
} = useManagerApproval();

const uiStore = useUIStore();
const canSell = computed(() => authStore.hasRole(Role.Seller));

const router = useRouter();
const route = useRoute();
const inSellerLayout = computed(() => route?.name === 'Sales');
const { page, limit, search } = useListPaging(() => fetchSales());
const {
    categories,
    cashiers,
    error: filterError,
    refresh: refreshLookups,
} = useSalesLookups(authStore.isAdmin);
const filters = reactive({
    saleNumber:
        typeof router.currentRoute?.value.query.saleNumber === 'string' &&
        REPORT_LIMITS.SALE_SEARCH.test(
            router.currentRoute.value.query.saleNumber,
        )
            ? router.currentRoute.value.query.saleNumber
            : '',
    dateFrom: '',
    dateTo: '',
    paymentType: null as string | null,
    cashier: null as string | null,
    category: null as string | null,
});
const appliedFilters = ref<Record<string, string>>(
    filters.saleNumber ? { saleNumber: filters.saleNumber } : {},
);
const searchError = ref('');
function applyFilters() {
    searchError.value = '';
    if (
        filters.saleNumber &&
        !REPORT_LIMITS.SALE_SEARCH.test(filters.saleNumber.trim())
    ) {
        searchError.value =
            'Enter a full sale ID or its final eight hexadecimal characters.';
        return;
    }
    if (dateRangeError(filters.dateFrom, filters.dateTo)) {
        searchError.value = dateRangeError(filters.dateFrom, filters.dateTo);
        return;
    }
    appliedFilters.value = Object.fromEntries(
        Object.entries(filters)
            .filter(([, value]) => value)
            .map(([key, value]) => [key, String(value).trim()]),
    );
    search();
}
const chips = computed<FilterChip[]>(() => {
    const a = appliedFilters.value;
    const out: FilterChip[] = [];
    if (a.saleNumber)
        out.push({ key: 'saleNumber', label: `Sale: ${a.saleNumber}` });
    if (a.dateFrom)
        out.push({
            key: 'dateFrom',
            label: `From: ${a.dateFrom}`,
            inPanel: true,
        });
    if (a.dateTo)
        out.push({ key: 'dateTo', label: `To: ${a.dateTo}`, inPanel: true });
    if (a.paymentType)
        out.push({
            key: 'paymentType',
            label: `Payment: ${a.paymentType}`,
            inPanel: true,
        });
    if (a.cashier)
        out.push({
            key: 'cashier',
            label: `Cashier: ${cashiers.value.find((row) => row._id === a.cashier)?.name ?? a.cashier}`,
            inPanel: true,
        });
    if (a.category)
        out.push({
            key: 'category',
            label: `Category: ${categories.value.find((row) => row._id === a.category)?.name ?? a.category}`,
            inPanel: true,
        });
    return out;
});
/*
 * Removing a chip drops that filter only: the search box goes back to
 * its applied text and every input to its applied value first, so
 * typed-but-unsearched text or a refused range is never sent.
 */
function removeFilter(key: string) {
    const a = appliedFilters.value;
    Object.assign(filters, {
        saleNumber: a.saleNumber ?? '',
        dateFrom: a.dateFrom ?? '',
        dateTo: a.dateTo ?? '',
        paymentType: a.paymentType ?? null,
        cashier: a.cashier ?? null,
        category: a.category ?? null,
    });
    if (key === 'saleNumber' || key === 'dateFrom' || key === 'dateTo')
        filters[key] = '';
    else if (key === 'paymentType' || key === 'cashier' || key === 'category')
        filters[key] = null;
    applyFilters();
}
function clearFilters() {
    Object.assign(filters, {
        saleNumber: '',
        dateFrom: '',
        dateTo: '',
        paymentType: null,
        cashier: null,
        category: null,
    });
    applyFilters();
}
const totalItems = ref(0);
const serverItems = ref<SaleListRow[]>([]);

const detailHeaders: TableHeader[] = [
    { key: 'product', title: 'Product', rowHeader: true },
    { key: 'qty', title: 'Qty', align: 'right' },
    { key: 'unitPrice', title: 'Unit Price', align: 'right' },
    { key: 'total', title: 'Total', align: 'right' },
];
const headers = [
    { key: 'saleNumber', title: 'Sale #' },
    { key: 'cashier', title: 'Cashier' },
    { key: 'amount', title: 'Amount', align: 'right' as const },
    { key: 'paymentType', title: 'Payment' },
    { key: 'status', title: 'Status' },
    { key: 'date', title: 'Date' },
];

function formatDate(value: string | Date): string {
    return formatStoreDateTime(
        value instanceof Date ? value.toISOString() : value,
    );
}

function statusColor(status: SaleStatus) {
    return status === SaleStatus.COMPLETED ? 'success' : 'error';
}

function reversalLabel(type: ReversalType): string {
    return type === ReversalType.VOID ? 'Void' : 'Refund';
}

const {
    loading,
    error: loadError,
    load: fetchSales,
} = useListFetch(
    () =>
        api.get<Paginated<SaleRow>>(`/sales`, {
            params: {
                page: page.value,
                limit: limit.value,
                ...appliedFilters.value,
            },
        }),
    (result) => {
        serverItems.value = result.data.data.map((sale) => ({
            id: sale._id,
            saleNumber: saleNumber(sale._id),
            cashier: sale.cashier?.name ?? 'N/A',
            amount: formatCurrency(sale.amount ?? 0),
            totals: {
                offline: sale.offline,
                soldAt: sale.soldAt,
                stockShortfall: sale.stockShortfall,
                lateOffline: sale.lateOffline,
                amount: sale.amount ?? 0,
                discount: sale.discount ?? null,
                // Sales from before statuses existed are completed.
                status: sale.status ?? SaleStatus.COMPLETED,
                paymentType: sale.paymentType,
                tenders: sale.tenders ?? [],
                changeGiven: sale.changeGiven ?? 0,
                referenceNumber: sale.referenceNumber ?? null,
                reversal: sale.reversal ?? null,
                shift: sale.shift ?? null,
            } satisfies SaleTotals,
            paymentType: sale.paymentType,
            status: sale.status ?? SaleStatus.COMPLETED,
            date: formatDate(sale.soldAt ?? sale.createdAt),
        }));

        totalItems.value = result.data.totalItems;
    },
    'Could not load the sales.',
);

void fetchSales();

const isDialogOpen = ref(false);
const detailsLoading = ref(false);
const details = ref<SaleLine[]>([]);
const detailsError = ref('');
const selectedId = ref('');
const selectedSale = ref<SaleTotals | null>(null);

function discountLabel(discount: ReceiptDiscount): string {
    return discount.type === DiscountType.PERCENT
        ? `${discount.value}%`
        : 'fixed';
}

// Whole-sale reversals require manager approval; sellers see only their own current-shift sales.
const canReverse = computed(
    () =>
        !useOfflineStore().offline &&
        (authStore.isAdmin || authStore.user?.roles.includes(Role.Seller)) &&
        selectedSale.value?.status === SaleStatus.COMPLETED,
);
const pendingReversal = ref<ReversalType | null>(null);
const reversalReason = ref('');
const reversing = ref(false);

/**
 * Cash a void or refund hands back (issue #2): the sale's cash tender less
 * change, the same `saleNetCash` the API pays out. It comes out of the
 * sale's own shift while that is open; otherwise the admin picks an open
 * shift whose drawer pays it.
 */
const reversalCash = computed(() =>
    selectedSale.value
        ? saleNetCash({
              paymentType: selectedSale.value.paymentType,
              amount: selectedSale.value.amount,
              tenders: selectedSale.value.tenders,
              changeGiven: selectedSale.value.changeGiven,
          })
        : 0,
);
const openShifts = ref<ShiftListItem[]>([]);
const loadingShifts = ref(false);
/** Why the open shifts could not be loaded; never read as "none open". */
const shiftsError = ref('');
/** True when an open shift must be chosen to pay the cash back. */
const payoutRequired = ref(false);
const payoutShiftId = ref('');

const payoutOptions = computed(() => [
    { value: '', label: 'Choose an open shift…' },
    ...openShifts.value.map((shift) => ({
        value: shift._id,
        label: `${shift.cashierName} · ${shift.terminal} · opened ${formatDate(shift.openedAt)}`,
    })),
]);

const canConfirmReversal = computed(
    () =>
        !!reversalReason.value.trim() &&
        !loadingShifts.value &&
        (!payoutRequired.value || !!payoutShiftId.value),
);

/** Loads the open shifts and works out whether one must be chosen. */
async function loadPayoutShifts(forceChoice = false) {
    const sale = selectedSale.value;
    if (!sale || reversalCash.value === 0 || !authStore.isAdmin) {
        payoutRequired.value = false;
        return;
    }
    loadingShifts.value = true;
    shiftsError.value = '';
    try {
        const res = await api.get<Paginated<ShiftListItem>>('/shifts', {
            params: { page: 1, limit: 100, status: ShiftStatus.OPEN },
        });
        openShifts.value = res.data.data;
    } catch (error) {
        // Unknown, not "none open": say so and offer a retry. Without a
        // forced choice the server decides; it answers
        // SHIFT_PAYOUT_REQUIRED if a shift must be chosen.
        shiftsError.value = apiErrorText(error, 'Please try again.');
        openShifts.value = [];
        payoutRequired.value = forceChoice;
        return;
    } finally {
        loadingShifts.value = false;
    }
    const ownShiftOpen =
        !!sale.shift && openShifts.value.some((s) => s._id === sale.shift);
    payoutRequired.value = forceChoice || !ownShiftOpen;
    // Never preselected: the admin picks the drawer that pays.
    if (
        !payoutRequired.value ||
        !openShifts.value.some((s) => s._id === payoutShiftId.value)
    ) {
        payoutShiftId.value = '';
    }
}

function startReversal(type: ReversalType) {
    pendingReversal.value = type;
    shiftsError.value = '';
    reversalReason.value = '';
    payoutShiftId.value = '';
    payoutRequired.value = false;
    void loadPayoutShifts();
}

function cancelReversal() {
    pendingReversal.value = null;
    shiftsError.value = '';
    reversalReason.value = '';
    payoutShiftId.value = '';
    payoutRequired.value = false;
}

async function confirmReversal() {
    const type = pendingReversal.value;
    const reason = reversalReason.value.trim();
    if (!type || !canConfirmReversal.value || reversing.value) return;

    reversing.value = true;
    const action = type === ReversalType.VOID ? 'void' : 'refund';
    try {
        const body = {
            reason,
            ...(payoutRequired.value && { payoutShiftId: payoutShiftId.value }),
        } satisfies ReverseSaleRequest;
        const token = await requestApproval(
            {
                action:
                    type === ReversalType.VOID
                        ? OverrideAction.VOID
                        : OverrideAction.REFUND,
                context: { reversal: { saleId: selectedId.value, ...body } },
            },
            `${reversalLabel(type)} sale ${selectedId.value} for ${formatCurrency(selectedSale.value?.amount ?? 0)}. Reason: ${reason}`,
        );
        if (!token) return;
        await api.post(`/sales/${selectedId.value}/${action}`, body, {
            headers: { 'X-Manager-Approval': token },
        });
        uiStore.queueMessage(
            Color.SUCCESS,
            `Sale ${type === ReversalType.VOID ? 'voided' : 'refunded'}; stock returned`,
        );
        cancelReversal();
        isDialogOpen.value = false;
        await fetchSales();
    } catch (error) {
        const code = apiErrorCode(error);
        // The sale's shift closed since the check: ask for a shift now.
        if (
            code === ErrorCode.SHIFT_PAYOUT_REQUIRED ||
            code === ErrorCode.SHIFT_CLOSED
        ) {
            await loadPayoutShifts(true);
        }
        uiStore.queueMessage(
            Color.ERROR,
            apiErrorMessages(error, `Could not ${action} the sale`),
        );
    } finally {
        reversing.value = false;
    }
}

async function showDetails(row: SaleListRow) {
    cancelReversal();
    selectedId.value = row.id;
    selectedSale.value = row.totals;
    isDialogOpen.value = true;
    await loadDetails();
}

/** Counts detail loads, so only the latest one may write (issue #20). */
let detailsCall = 0;

/**
 * Loads the selected sale's lines. The previous sale's lines are cleared
 * first, so they never show under this one's spinner, and a slower
 * response for a sale clicked earlier is dropped when it lands after a
 * later click (issue #20).
 */
async function loadDetails() {
    const call = ++detailsCall;
    detailsLoading.value = true;
    detailsError.value = '';
    details.value = [];
    try {
        const res = await api.get<SaleLine[]>(
            `/sales/details/${selectedId.value}`,
        );
        if (call === detailsCall) details.value = res.data;
    } catch (error) {
        if (call === detailsCall) {
            detailsError.value = apiErrorText(
                error,
                'Could not load the sale details.',
            );
        }
    } finally {
        if (call === detailsCall) detailsLoading.value = false;
    }
}
</script>
