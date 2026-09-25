<template>
    <div class="flex-1 flex flex-col overflow-hidden bg-slate-100">
        <header
            class="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-5 bg-white border-b border-slate-200 gap-4"
        >
            <div>
                <h1
                    class="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight"
                >
                    Orders & Transactions
                </h1>
                <p class="text-xs sm:text-sm text-slate-500 mt-0.5">
                    View transaction history and reprint receipts
                </p>
            </div>

            <div class="flex items-center gap-3">
                <div
                    class="bg-slate-50 border border-slate-200 px-3.5 py-1.5 rounded-xl text-right"
                >
                    <span
                        class="text-[10px] font-bold uppercase tracking-wider text-slate-500"
                        >Transactions</span
                    >
                    <p class="text-base font-extrabold text-slate-900">
                        {{ totalItems }}
                    </p>
                </div>
                <button
                    v-if="canSell"
                    type="button"
                    class="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white text-xs sm:text-sm font-bold px-4 py-2 rounded-xl transition-all active:scale-[0.98] shadow-xs"
                    @click="router.push({ name: 'Sell' })"
                >
                    <Plus class="w-4 h-4" />
                    New Sale
                </button>
            </div>
        </header>

        <div class="flex-1 overflow-y-auto p-6">
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
                <template #cell-status="{ value }">
                    <Badge :color="statusColor(value)">{{ value }}</Badge>
                </template>
            </BaseTable>
        </div>

        <BaseModal
            v-model="isDialogOpen"
            title="Sale Details"
            max-width="36rem"
            scrollable
        >
            <table class="w-full text-left border-collapse text-sm">
                <thead>
                    <tr
                        class="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"
                    >
                        <th class="py-2.5 px-4">Product</th>
                        <th class="py-2.5 px-4">Qty</th>
                        <th class="py-2.5 px-4 text-right">Unit Price</th>
                        <th class="py-2.5 px-4 text-right">Total</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    <tr v-if="detailsLoading">
                        <td colspan="4" class="py-4 text-center">
                            <Spinner class="mx-auto text-slate-400" />
                        </td>
                    </tr>
                    <tr v-else-if="detailsError">
                        <td colspan="4" class="py-4 text-center">
                            <div
                                role="alert"
                                data-testid="details-error"
                                class="flex flex-col items-center gap-2 text-sm"
                            >
                                <p class="font-bold text-red-700">
                                    {{ detailsError }}
                                </p>
                                <BaseButton
                                    variant="outline"
                                    size="sm"
                                    @click="loadDetails"
                                    >Retry</BaseButton
                                >
                            </div>
                        </td>
                    </tr>
                    <tr v-for="d in details" :key="d._id">
                        <td class="py-3 px-4">
                            {{ d.product?.name ?? 'N/A' }}
                        </td>
                        <td class="py-3 px-4">{{ d.quantity }}</td>
                        <td class="py-3 px-4 text-right">
                            {{ formatCurrency(d.unitPrice ?? 0) }}
                        </td>
                        <td class="py-3 px-4 text-right">
                            {{
                                formatCurrency((d.unitPrice ?? 0) * d.quantity)
                            }}
                        </td>
                    </tr>
                </tbody>
                <tfoot
                    v-if="!detailsLoading && selectedSale"
                    class="border-t border-slate-200 text-sm"
                >
                    <template v-if="selectedSale.discount">
                        <tr>
                            <td colspan="3" class="py-2 px-4 text-slate-500">
                                Subtotal
                            </td>
                            <td class="py-2 px-4 text-right">
                                {{
                                    formatCurrency(
                                        selectedSale.amount +
                                            selectedSale.discount.amount,
                                    )
                                }}
                            </td>
                        </tr>
                        <tr class="text-emerald-700">
                            <td colspan="3" class="py-2 px-4">
                                Discount ({{
                                    discountLabel(selectedSale.discount)
                                }}) &mdash; {{ selectedSale.discount.reason }}
                            </td>
                            <td class="py-2 px-4 text-right">
                                -{{
                                    formatCurrency(selectedSale.discount.amount)
                                }}
                            </td>
                        </tr>
                    </template>
                    <tr class="font-bold text-slate-900">
                        <td colspan="3" class="py-2 px-4">Total charged</td>
                        <td class="py-2 px-4 text-right">
                            {{ formatCurrency(selectedSale.amount) }}
                        </td>
                    </tr>
                </tfoot>
            </table>

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
                    <span>{{ formatCurrency(selectedSale.changeGiven) }}</span>
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
                            formatCurrency(selectedSale.reversal.payoutAmount)
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
                    {{ formatCurrency(reversalCash) }} cash is paid back out of
                    the drawer of the shift this sale was rung in.
                </p>
                <template v-else>
                    <p
                        v-if="openShifts.length === 0"
                        class="text-xs font-bold text-red-800"
                        data-testid="payout-no-open-shift"
                    >
                        {{ formatCurrency(reversalCash) }} cash must be paid
                        back, but no shift is open to pay it from. Open a shift
                        first.
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
                    <BaseButton variant="outline" @click="isDialogOpen = false"
                        >Close</BaseButton
                    >
                </template>
            </template>
        </BaseModal>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Plus } from '@lucide/vue';
import api from '@/axios';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import Badge from '@/components/ui/Badge.vue';
import Spinner from '@/components/ui/Spinner.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import { formatCurrency } from '@/utils/currency';
import { apiErrorMessages, apiErrorText } from '@/utils/api-error';
import { useListFetch } from '@/composables/useListFetch';
import {
    DiscountType,
    ErrorCode,
    type Paginated,
    PaymentType,
    ReversalType,
    Role,
    saleNetCash,
    SaleStatus,
    type ShiftListItem,
    ShiftStatus,
    STRING_LIMITS,
    type Tender,
} from '@grocery-pos/contracts';
import type {
    ReceiptDiscount,
    SaleReversal,
} from '@/components/User/Sales/types';
import { paymentLabel, tenderLabel } from '@/components/User/Sales/checkout';
import { useAuthStore } from '@/stores/auth';
import { apiErrorCode } from '@/stores/shift';
import { Color, useUIStore } from '@/stores/ui';

/** The ledger fields of a sale that explain its total (centavos). */
interface SaleTotals {
    amount: number;
    discount: ReceiptDiscount | null;
    status: SaleStatus;
    paymentType: PaymentType;
    /** Empty for sales recorded before tenders were stored. */
    tenders: Tender[];
    changeGiven: number;
    referenceNumber: string | null;
    reversal: SaleReversal | null;
    /** The shift the sale was rung in; null for sales from before shifts. */
    shift: string | null;
}

const authStore = useAuthStore();
const uiStore = useUIStore();
const canSell = computed(() => authStore.hasRole(Role.Seller));

const router = useRouter();
const limit = ref(5);
const page = ref(1);
const totalItems = ref(0);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const serverItems = ref<any[]>([]);

const headers = [
    { key: 'cashier', title: 'Cashier' },
    { key: 'amount', title: 'Amount' },
    { key: 'paymentType', title: 'Payment' },
    { key: 'status', title: 'Status' },
    { key: 'date', title: 'Date' },
];

function formatDate(value: string | Date): string {
    return new Date(value).toLocaleString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
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
        api.get(`/sales`, {
            params: { page: page.value, limit: limit.value },
        }),
    (result) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serverItems.value = result.data.data.map((sale: any) => ({
            id: sale._id,
            cashier: sale.cashier?.name ?? 'N/A',
            amount: formatCurrency(sale.amount ?? 0),
            totals: {
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
            date: formatDate(sale.createdAt),
        }));

        totalItems.value = result.data.totalItems;
    },
    'Could not load the sales.',
);

fetchSales();
watch([page, limit], fetchSales);

const isDialogOpen = ref(false);
const detailsLoading = ref(false);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const details = ref<any[]>([]);
const detailsError = ref('');
const selectedId = ref('');
const selectedSale = ref<SaleTotals | null>(null);

function discountLabel(discount: ReceiptDiscount): string {
    return discount.type === DiscountType.PERCENT
        ? `${discount.value}%`
        : 'fixed';
}

// Void / refund: admin only, whole sale only, and only while COMPLETED.
const canReverse = computed(
    () =>
        authStore.isAdmin &&
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
    if (!sale || reversalCash.value === 0) {
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
        await api.post(`/sales/${selectedId.value}/${action}`, {
            reason,
            ...(payoutRequired.value && {
                payoutShiftId: payoutShiftId.value,
            }),
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function showDetails(row: any) {
    cancelReversal();
    selectedId.value = row.id;
    selectedSale.value = row.totals ?? null;
    isDialogOpen.value = true;
    await loadDetails();
}

async function loadDetails() {
    detailsLoading.value = true;
    detailsError.value = '';
    details.value = [];
    try {
        const res = await api.get(`/sales/details/${selectedId.value}`);
        details.value = res.data;
    } catch (error) {
        detailsError.value = apiErrorText(
            error,
            'Could not load the sale details.',
        );
    } finally {
        detailsLoading.value = false;
    }
}
</script>
