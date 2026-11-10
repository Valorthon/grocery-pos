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
            <PageCard>
                <FilterBar
                    v-model:search="filters.saleNumber"
                    search-id="sales-number"
                    search-label="Sale number or full ID"
                    :maxlength="24"
                    :active="filtersActive"
                    class="px-5 py-4 border-b border-line"
                    @search="applyFilters"
                    @clear="clearFilters"
                >
                    <BaseSelect
                        id="sales-preset"
                        :model-value="datePreset"
                        label="Dates"
                        all-label="All dates"
                        :options="DATE_PRESET_OPTIONS"
                        @update:model-value="pickPreset"
                    />
                    <BaseInput
                        id="sales-from"
                        v-model="filters.dateFrom"
                        label="From"
                        type="date"
                        @change="editDate"
                    />
                    <BaseInput
                        id="sales-to"
                        v-model="filters.dateTo"
                        label="To (inclusive)"
                        type="date"
                        @change="editDate"
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
                                    row.name +
                                    (row.isActive ? '' : ' (archived)'),
                                value: row._id,
                            }))
                        "
                        @update:model-value="applyFilters"
                    />
                </FilterBar>
                <p
                    v-if="filterError"
                    role="alert"
                    class="px-5 py-3 text-sm text-red-700"
                >
                    {{ filterError }}
                    <BaseButton variant="outline" @click="refreshLookups"
                        >Retry filters</BaseButton
                    >
                </p>
                <p
                    v-if="searchError"
                    role="alert"
                    class="px-5 py-3 text-sm text-red-700"
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
                            :color="
                                value === PaymentType.CASH ? 'success' : 'info'
                            "
                            >{{ value }}</Badge
                        >
                    </template>
                    <template #cell-status="{ item, value }">
                        <Badge :color="statusColor(item.status)">{{
                            value
                        }}</Badge>
                    </template>
                </BaseTable>
            </PageCard>

            <BaseModal
                v-model="isDialogOpen"
                :title="pendingReversal ? reversalTitle : 'Sale Details'"
                max-width="32rem"
                scrollable
                :closable="!reversing"
            >
                <!-- The receipt (#218); the void/refund panel replaces it. -->
                <div
                    v-if="selectedSale && !pendingReversal"
                    class="space-y-4 text-sm"
                    data-testid="sale-receipt"
                >
                    <header class="space-y-2">
                        <p
                            class="text-xs font-bold uppercase tracking-widest text-muted"
                            data-testid="sale-store"
                        >
                            {{ identity.storeName
                            }}<template v-if="identity.branchName">
                                · {{ identity.branchName }}</template
                            >
                        </p>
                        <div
                            class="flex items-center justify-between gap-2"
                            data-testid="sale-total-row"
                        >
                            <p
                                class="num text-2xl font-extrabold text-ink"
                                data-testid="sale-total"
                            >
                                {{ formatCurrency(selectedSale.amount) }}
                            </p>
                            <Badge :color="statusColor(selectedSale.status)">{{
                                selectedSale.status
                            }}</Badge>
                        </div>
                        <dl
                            class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 text-xs"
                            data-testid="sale-detail-grid"
                        >
                            <template v-if="selectedSale.offline">
                                <div
                                    class="contents"
                                    data-testid="sale-detail-date"
                                >
                                    <dt class="text-muted">Occurred</dt>
                                    <dd class="text-ink">
                                        <time :datetime="selectedSale.soldAt">{{
                                            receiptDate(selectedSale.soldAt)
                                        }}</time>
                                    </dd>
                                </div>
                                <div
                                    class="contents"
                                    data-testid="sale-detail-recorded"
                                >
                                    <dt class="text-muted">Recorded</dt>
                                    <dd class="text-ink">
                                        <time
                                            :datetime="selectedSale.createdAt"
                                            >{{
                                                receiptDate(
                                                    selectedSale.createdAt,
                                                )
                                            }}</time
                                        >
                                    </dd>
                                </div>
                            </template>
                            <template v-else>
                                <div
                                    class="contents"
                                    data-testid="sale-detail-date"
                                >
                                    <dt class="text-muted">Date</dt>
                                    <dd class="text-ink">
                                        <time
                                            :datetime="selectedSale.createdAt"
                                            >{{
                                                receiptDate(
                                                    selectedSale.createdAt,
                                                )
                                            }}</time
                                        >
                                    </dd>
                                </div>
                            </template>
                            <template v-if="selectedRow">
                                <div
                                    class="contents"
                                    data-testid="sale-detail-cashier"
                                >
                                    <dt class="text-muted">Cashier</dt>
                                    <dd class="text-ink">
                                        {{ selectedRow.cashier }}
                                    </dd>
                                </div>
                            </template>
                            <dt class="text-muted">Sale</dt>
                            <dd class="min-w-0">
                                <div class="flex items-center gap-1">
                                    <span
                                        class="font-bold text-ink"
                                        data-testid="sale-number"
                                        >#{{ saleNumber(selectedId) }}</span
                                    >
                                    <BaseButton
                                        variant="ghost"
                                        size="sm"
                                        class="w-11 h-11 p-0"
                                        aria-label="Copy full ID"
                                        title="Copy full ID"
                                        data-testid="sale-id-copy"
                                        @click="copyId"
                                        ><Copy class="w-4 h-4"
                                    /></BaseButton>
                                </div>
                                <code
                                    class="block break-all text-xs text-muted"
                                    data-testid="sale-full-id"
                                    >{{ selectedId }}</code
                                >
                            </dd>
                        </dl>
                    </header>

                    <p
                        v-if="selectedSale.offline"
                        class="rounded-control border border-warning-border bg-warning-bg p-2.5 text-xs text-warning-fg"
                        data-testid="sale-offline-notice"
                    >
                        Offline cash sale.
                        <strong v-if="selectedSale.stockShortfall"
                            >Stock shortfall — reconcile inventory.</strong
                        >
                        <span v-if="selectedSale.lateOffline"
                            >Admin-recorded after shift close; shown as a
                            separate closing-report addendum.</span
                        >
                    </p>

                    <section
                        class="border-t border-dashed border-line-strong pt-3"
                        data-testid="details-table"
                        aria-label="Items"
                    >
                        <div
                            v-if="detailsLoading"
                            class="flex justify-center py-4 text-muted"
                        >
                            <Spinner />
                        </div>
                        <div
                            v-else-if="detailsError"
                            role="alert"
                            class="flex flex-wrap items-center gap-2 text-sm text-danger-fg"
                            data-testid="table-error"
                        >
                            <span class="flex-1">{{ detailsError }}</span>
                            <BaseButton
                                variant="outline"
                                size="sm"
                                @click="loadDetails"
                                >Retry</BaseButton
                            >
                        </div>
                        <p v-else-if="!details.length" class="text-muted">
                            No lines on this sale
                        </p>
                        <ul v-else class="space-y-2">
                            <li
                                v-for="line in details"
                                :key="line._id"
                                class="flex items-start justify-between gap-3"
                                data-testid="sale-line"
                            >
                                <div>
                                    <p class="font-bold text-ink">
                                        {{ line.product?.name ?? 'N/A' }}
                                    </p>
                                    <p class="text-xs text-muted num">
                                        {{ lineQuantity(line) }} ×
                                        {{ formatCurrency(line.unitPrice ?? 0)
                                        }}{{ perUnit(line) }}
                                    </p>
                                </div>
                                <span class="num font-bold text-ink">{{
                                    formatCurrency(
                                        quantityAmount(
                                            line.unitPrice ?? 0,
                                            line.quantity,
                                            line.unit,
                                        ),
                                    )
                                }}</span>
                            </li>
                        </ul>
                    </section>

                    <!-- From the list row, so it stays visible when the lines fail to load. -->
                    <section
                        v-if="!detailsLoading"
                        class="space-y-1 border-t border-dashed border-line-strong pt-3"
                        aria-label="Totals"
                    >
                        <template v-if="selectedSale.discount">
                            <div class="flex justify-between text-muted">
                                <span>Subtotal</span>
                                <span class="num">{{
                                    formatCurrency(
                                        selectedSale.amount +
                                            selectedSale.discount.amount,
                                    )
                                }}</span>
                            </div>
                            <div
                                class="flex justify-between gap-3 text-success-fg"
                                data-testid="sale-discount"
                            >
                                <span
                                    >Discount ({{
                                        discountLabel(selectedSale.discount)
                                    }}) —
                                    {{ selectedSale.discount.reason }}</span
                                >
                                <span class="num"
                                    >-{{
                                        formatCurrency(
                                            selectedSale.discount.amount,
                                        )
                                    }}</span
                                >
                            </div>
                        </template>
                        <p
                            data-testid="details-total"
                            class="flex justify-between font-bold text-ink"
                        >
                            <span>Total charged</span>
                            <span class="num">{{
                                formatCurrency(selectedSale.amount)
                            }}</span>
                        </p>
                    </section>

                    <section
                        class="space-y-1 border-t border-dashed border-line-strong pt-3"
                        aria-label="Payment"
                    >
                        <div class="flex justify-between">
                            <span class="text-muted">Payment</span>
                            <span class="font-semibold">{{
                                paymentLabel(selectedSale.paymentType)
                            }}</span>
                        </div>
                        <div
                            v-for="tender in selectedSale.tenders"
                            :key="tender.type"
                            class="flex justify-between"
                        >
                            <span class="text-muted">{{
                                tenderLabel(tender.type)
                            }}</span>
                            <span class="num">{{
                                formatCurrency(tender.amount)
                            }}</span>
                        </div>
                        <div
                            v-if="hasCashTender(selectedSale)"
                            class="flex justify-between"
                            data-testid="sale-change"
                        >
                            <span class="text-muted">Change</span>
                            <span class="num">{{
                                formatCurrency(selectedSale.changeGiven)
                            }}</span>
                        </div>
                        <div
                            v-if="selectedSale.referenceNumber"
                            class="flex justify-between"
                            data-testid="sale-reference"
                        >
                            <span class="text-muted">GCash Ref</span>
                            <span class="font-mono"
                                >#{{ selectedSale.referenceNumber }}</span
                            >
                        </div>
                    </section>

                    <section
                        v-if="selectedSale.reversal"
                        class="space-y-1 rounded-control border border-danger-border bg-danger-bg p-3 text-xs text-danger-fg"
                        data-testid="sale-reversal"
                        aria-label="Reversal"
                    >
                        <p class="font-bold">
                            {{ reversedLabel(selectedSale.reversal.type) }} on
                            {{ receiptDate(selectedSale.reversal.at) }}
                        </p>
                        <p>Reason: {{ selectedSale.reversal.reason }}</p>
                        <p v-if="selectedSale.reversal.payoutAmount">
                            {{
                                formatCurrency(
                                    selectedSale.reversal.payoutAmount,
                                )
                            }}
                            cash paid back
                        </p>
                    </section>

                    <section
                        v-if="adminFacts.length"
                        class="space-y-1 border-t border-line pt-3 text-xs"
                        data-testid="sale-admin-facts"
                        aria-label="Approvals"
                    >
                        <div
                            v-for="fact in adminFacts"
                            :key="fact.label"
                            class="flex justify-between gap-3"
                        >
                            <span class="text-muted">{{ fact.label }}</span>
                            <span class="font-semibold text-right">{{
                                fact.value
                            }}</span>
                        </div>
                    </section>
                </div>

                <!-- The void/refund panel (#218): Back keeps what was entered. -->
                <div
                    v-if="pendingReversal && selectedSale"
                    class="space-y-3 text-sm"
                    data-testid="reversal-panel"
                >
                    <p class="text-center">
                        <span class="block text-xs text-muted"
                            >Sale #{{ saleNumber(selectedId) }}</span
                        >
                        <span
                            class="num text-3xl font-extrabold text-ink"
                            data-testid="reversal-amount"
                            >{{ formatCurrency(selectedSale.amount) }}</span
                        >
                    </p>
                    <p class="text-xs text-muted">
                        Every item goes back into stock and the sale no longer
                        counts toward revenue. This cannot be undone.
                    </p>
                    <BaseInput
                        id="reversal-reason"
                        v-model="reversalReason"
                        label="Reason"
                        :maxlength="STRING_LIMITS.REASON"
                        :placeholder="
                            pendingReversal === ReversalType.VOID
                                ? 'e.g. rang up twice'
                                : 'e.g. customer returned the items'
                        "
                    />
                    <p
                        v-if="reversalCash === 0"
                        class="text-xs text-muted"
                        data-testid="payout-none"
                    >
                        No cash is paid back: the sale was paid by GCash.
                    </p>
                    <p
                        v-else-if="loadingShifts"
                        class="text-xs text-muted"
                        data-testid="payout-loading"
                    >
                        Checking open shifts…
                    </p>
                    <div
                        v-else-if="shiftsError"
                        role="alert"
                        class="flex flex-wrap items-center gap-2 text-xs font-bold text-danger-fg"
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
                        class="text-xs text-muted"
                        data-testid="payout-own-shift"
                    >
                        {{ formatCurrency(reversalCash) }} cash is paid back out
                        of the drawer of the shift this sale was rung in.
                    </p>
                    <template v-else>
                        <p
                            v-if="openShifts.length === 0"
                            class="text-xs font-bold text-danger-fg"
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
                </div>

                <template #footer>
                    <div
                        class="flex w-full flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between"
                        data-testid="sale-footer"
                    >
                        <template v-if="pendingReversal">
                            <BaseButton
                                variant="outline"
                                :disabled="reversing"
                                data-testid="reversal-back"
                                @click="backToReceipt"
                                >Back</BaseButton
                            >
                            <BaseButton
                                variant="danger-solid"
                                class="disabled:bg-paper disabled:text-muted disabled:border disabled:border-line-strong disabled:shadow-none"
                                :loading="reversing"
                                :disabled="!canConfirmReversal"
                                data-testid="reversal-confirm"
                                @click="confirmReversal"
                                >Confirm
                                {{
                                    reversalLabel(pendingReversal).toLowerCase()
                                }}</BaseButton
                            >
                        </template>
                        <template v-else>
                            <div
                                v-if="canReverse"
                                class="flex flex-col gap-2.5 sm:flex-row"
                                data-testid="sale-reverse-actions"
                            >
                                <BaseButton
                                    variant="danger"
                                    class="border border-danger-border bg-danger-bg"
                                    @click="startReversal(ReversalType.VOID)"
                                    >Void sale</BaseButton
                                >
                                <BaseButton
                                    variant="danger"
                                    class="border border-danger-border bg-danger-bg"
                                    @click="startReversal(ReversalType.REFUND)"
                                    >Refund sale</BaseButton
                                >
                            </div>
                            <BaseButton
                                variant="outline"
                                class="sm:ml-auto"
                                data-testid="sale-close"
                                @click="isDialogOpen = false"
                                >Close</BaseButton
                            >
                        </template>
                    </div>
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
import {
    formatQuantity,
    quantityAmount,
    receiptStoreIdentity,
    type ReceiptStoreIdentity,
    type SaleDiscountView,
    UnitOfMeasure,
    unitLabel,
} from '@grocery-pos/contracts';
import { computed, reactive, ref, toRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageFrame from '@/components/ui/PageFrame.vue';
import { Copy, Plus } from '@lucide/vue';
import api from '@/axios';
import { useOfflineStore } from '@/stores/offline';
import ManagerOverrideDialog from '@/components/User/Sales/ManagerOverrideDialog.vue';
import { useManagerApproval } from '@/composables/useManagerApproval';

import BaseTable from '@/components/ui/BaseTable.vue';
import Spinner from '@/components/ui/Spinner.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import PageCard from '@/components/ui/PageCard.vue';
import FilterBar from '@/components/ui/FilterBar.vue';
import { useDatePreset } from '@/composables/useDatePreset';
import {
    DATE_PRESET_OPTIONS,
    type DatePreset,
} from '@/views/User/Reports/presets';
import { useSalesLookups } from '@/composables/useSalesLookups';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import Badge from '@/components/ui/Badge.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import { formatCurrency } from '@/utils/currency';
import { dateRangeError } from '@/utils/rules';
import {
    discountLabel,
    hasCashTender,
    saleNumber,
} from '@/components/User/Sales/receipt';
import { storePresentation, terminalLabel } from '@/settings/presentation';
import { formatStoreDateTime } from '@/utils/datetime';
import {
    apiErrorCode,
    apiErrorMessages,
    apiErrorText,
} from '@/utils/api-error';
import { useListFetch, useListPaging } from '@/composables/useListFetch';
import {
    REPORT_LIMITS,
    ErrorCode,
    OverrideAction,
    type Paginated,
    PaymentType,
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
    discount: SaleDiscountView | null;
    status: SaleStatus;
    paymentType: PaymentType;
    /** Empty for sales recorded before tenders were stored. */
    tenders: Tender[];
    changeGiven: number;
    referenceNumber: string | null;
    reversal: SaleReversalView | null;
    /** The shift the sale was rung in; null for sales from before shifts. */
    shift: string | null;
    /** ISO: when the server recorded it. */
    createdAt: string;
    /** Absent on sales from before store settings (#47). */
    storeIdentity?: ReceiptStoreIdentity;
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
const {
    preset: datePreset,
    choose: choosePreset,
    edited: presetEdited,
    reset: resetPreset,
} = useDatePreset(
    toRef(filters, 'dateFrom'),
    toRef(filters, 'dateTo'),
    applyFilters,
);
/** A preset fills both dates, then applies once (#215). */
function pickPreset(value: string | null) {
    void choosePreset(value as DatePreset | null);
}
/** A manual date edit switches the preset to Custom and applies. */
function editDate() {
    presetEdited();
    applyFilters();
}
/** Clear Filters is enabled while any filter or preset is set. */
const filtersActive = computed(
    () =>
        !!datePreset.value ||
        Object.values(filters).some((value) => !!value) ||
        Object.keys(appliedFilters.value).length > 0,
);
function clearFilters() {
    resetPreset();
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

const headers = [
    { key: 'saleNumber', title: 'Sale #' },
    { key: 'cashier', title: 'Cashier', hideBelow: 'md' as const },
    { key: 'amount', title: 'Amount', align: 'right' as const },
    { key: 'paymentType', title: 'Payment', hideBelow: 'sm' as const },
    { key: 'status', title: 'Status' },
    { key: 'date', title: 'Date', hideBelow: 'lg' as const },
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

function reversedLabel(type: ReversalType): string {
    return type === ReversalType.VOID ? 'Voided' : 'Refunded';
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
                createdAt: sale.createdAt,
                storeIdentity: sale.storeIdentity,
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
/** The clicked row: its cashier and date, hidden from the list at phone width (#210). */
const selectedRow = ref<SaleListRow | null>(null);

/** The sale's own store snapshot, else the current settings, as the register receipt. */
const identity = computed(
    () =>
        selectedSale.value?.storeIdentity ??
        receiptStoreIdentity(storePresentation.value, terminalLabel.value),
);

/** A receipt time, in the timezone the sale was recorded under. */
function receiptDate(iso: string | undefined): string {
    return formatStoreDateTime(iso, identity.value.timezone);
}

function lineQuantity(line: SaleLine): string {
    return line.unit
        ? formatQuantity(line.quantity, line.unit)
        : String(line.quantity);
}

function perUnit(line: SaleLine): string {
    return line.unit && line.unit !== UnitOfMeasure.PIECE
        ? `/${unitLabel(line.unit)}`
        : '';
}

/** Approvers and the paying drawer: ADMIN only, as the API sends them. */
const adminFacts = computed(() => {
    const sale = selectedSale.value;
    if (!authStore.isAdmin || !sale) return [];
    const facts: { label: string; value: string }[] = [];
    const approver = sale.discount?.approvedByName ?? sale.discount?.approvedBy;
    if (approver)
        facts.push({ label: 'Discount approved by', value: approver });
    const reversalApprover =
        sale.reversal?.approvedByName ?? sale.reversal?.approvedBy;
    if (sale.reversal && reversalApprover) {
        facts.push({
            label: `${reversalLabel(sale.reversal.type)} approved by`,
            value: reversalApprover,
        });
    }
    if (sale.reversal?.payoutShift) {
        facts.push({
            label: 'Paid back from shift',
            value: `#${saleNumber(sale.reversal.payoutShift)}`,
        });
    }
    return facts;
});

/** The full id shows only on request (#218). */

async function copyId() {
    try {
        await navigator.clipboard.writeText(selectedId.value);
        uiStore.queueMessage(Color.SUCCESS, 'Sale ID copied');
    } catch {
        uiStore.queueMessage(Color.ERROR, 'Could not copy the sale ID');
    }
}

// Whole-sale reversals require manager approval; sellers see only their own current-shift sales.
const canReverse = computed(
    () =>
        !useOfflineStore().offline &&
        (authStore.isAdmin || authStore.user?.roles.includes(Role.Seller)) &&
        selectedSale.value?.status === SaleStatus.COMPLETED,
);
const pendingReversal = ref<ReversalType | null>(null);
const reversalTitle = computed(() =>
    pendingReversal.value === ReversalType.VOID ? 'Void sale' : 'Refund sale',
);
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
/** Counts open-shift loads, so only the latest one may write (#218). */
let shiftsCall = 0;

async function loadPayoutShifts(forceChoice = false) {
    const call = ++shiftsCall;
    const sale = selectedSale.value;
    if (!sale || reversalCash.value === 0 || !authStore.isAdmin) {
        payoutRequired.value = false;
        loadingShifts.value = false;
        return;
    }
    loadingShifts.value = true;
    shiftsError.value = '';
    try {
        const res = await api.get<Paginated<ShiftListItem>>('/shifts', {
            params: { page: 1, limit: 100, status: ShiftStatus.OPEN },
        });
        if (call !== shiftsCall) return;
        openShifts.value = res.data.data;
    } catch (error) {
        if (call !== shiftsCall) return;
        // Unknown, not "none open": say so and offer a retry. Without a
        // forced choice the server decides; it answers
        // SHIFT_PAYOUT_REQUIRED if a shift must be chosen.
        shiftsError.value = apiErrorText(error, 'Please try again.');
        openShifts.value = [];
        payoutRequired.value = forceChoice;
        return;
    } finally {
        if (call === shiftsCall) loadingShifts.value = false;
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

/**
 * Opens the void/refund panel. What was entered before Back stays; the
 * open shifts are checked again, keeping a chosen one that is still open.
 */
/** The type whose inputs the panel holds; another type starts afresh. */
let draftType: ReversalType | null = null;

function startReversal(type: ReversalType) {
    if (draftType !== type) {
        reversalReason.value = '';
        payoutShiftId.value = '';
    }
    draftType = type;
    pendingReversal.value = type;
    shiftsError.value = '';
    payoutRequired.value = false;
    void loadPayoutShifts();
}

/** Back to the receipt, keeping the reason and chosen shift. */
function backToReceipt() {
    pendingReversal.value = null;
}

function cancelReversal() {
    // Drops any open-shift load still in flight, e.g. across a sale switch.
    shiftsCall++;
    loadingShifts.value = false;
    draftType = null;
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
    selectedRow.value = row;
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
