<template>
    <PageFrame :breadcrumbs="breadcrumbs">
        <template #actions>
            <BaseButton v-if="!editing" size="sm" @click="startNew([])"
                >New purchase order</BaseButton
            >
            <BaseButton
                v-else
                size="sm"
                variant="outline"
                :disabled="busy"
                @click="closeEditor"
                >Back to list</BaseButton
            >
        </template>
        <PageCard>
            <div class="space-y-4 p-5">
                <template v-if="!editing">
                    <SegmentedFilter
                        v-model="statusFilter"
                        label="Status"
                        :options="statusOptions"
                        @update:model-value="apply"
                    />
                    <BaseTable
                        v-model:page="page"
                        v-model:items-per-page="limit"
                        :headers="headers"
                        :items="rows"
                        :loading="listLoading"
                        :error="listError"
                        empty-text="No purchase orders"
                        :items-length="totalItems"
                        row-click
                        row-hint="Press Enter to open the order"
                        @click:row="open"
                        @retry="load"
                    >
                        <template #cell-reference="{ item }">
                            {{ purchaseOrderReference(item._id) }}
                        </template>
                        <template #cell-createdAt="{ item }">
                            {{ formatDate(item.createdAt) }}
                        </template>
                        <template #cell-supplier="{ item }">
                            {{ supplierLabel(item) }}
                        </template>
                        <template #cell-status="{ item }">
                            <StatusBadge
                                :status="item.status"
                                :map="PURCHASE_ORDER_STATUS"
                                data-testid="po-status"
                            />
                            <span
                                v-if="draftSendBlockers(item).length"
                                class="block text-xs font-medium text-amber-700"
                                >Needs review before sending</span
                            >
                        </template>
                        <template #cell-lines="{ item }">
                            {{ item.lines.length }}
                        </template>
                        <template #cell-expectedTotal="{ item }">
                            {{ formatCurrency(item.expectedTotal) }}
                        </template>
                        <template #cell-action="{ item }">
                            <RowOpenButton
                                :label="`Open ${purchaseOrderReference(item._id)}`"
                                data-testid="po-open"
                                @open="open(item)"
                            />
                        </template>
                    </BaseTable>
                </template>
                <template v-else>
                    <div v-if="current" class="text-sm text-ink space-y-1">
                        <p>
                            <strong>{{
                                purchaseOrderReference(current._id)
                            }}</strong>
                            ·
                            <strong>{{ STATUS_LABELS[current.status] }}</strong>
                            · created {{ formatDate(current.createdAt) }}
                            <span v-if="current.createdBy">
                                by {{ current.createdBy.name }}</span
                            >
                        </p>
                        <p v-if="current.closedShort">
                            Cancelled after a partial receipt: the outstanding
                            quantities were closed short.
                        </p>
                        <p v-if="current.receipts.length">
                            {{ current.receipts.length }} linked
                            {{
                                current.receipts.length === 1
                                    ? 'receipt'
                                    : 'receipts'
                            }}
                            in Restock History.
                            <BaseButton
                                size="sm"
                                variant="outline"
                                @click="viewReceipts(current._id)"
                                >View receipts</BaseButton
                            >
                        </p>
                    </div>
                    <div
                        v-if="blockers.length"
                        role="status"
                        class="rounded-control border border-warning-border bg-warning-bg p-3 text-sm text-warning-fg"
                    >
                        <p class="font-medium">
                            This draft can't be sent as it stands.
                        </p>
                        <p v-for="text in blockers" :key="text">{{ text }}</p>
                        <p>
                            Choose an active supplier or remove the archived
                            products, then save.
                        </p>
                    </div>
                    <template v-if="isDraft">
                        <SupplierSelect v-model="supplier" :disabled="busy" />
                        <BaseInput
                            v-model="note"
                            label="Note (optional)"
                            :maxlength="PURCHASE_ORDER_LIMITS.NOTE"
                            :disabled="busy"
                        />
                    </template>
                    <template v-else-if="current">
                        <p class="text-sm">
                            Supplier: {{ supplierLabel(current) }}
                        </p>
                        <p v-if="current.note" class="text-sm">
                            Note: {{ current.note }}
                        </p>
                    </template>
                    <p
                        v-if="validation"
                        role="alert"
                        class="text-sm text-danger-fg"
                    >
                        {{ validation }}
                    </p>

                    <EmptyState
                        v-if="isDraft && draft.length === 0"
                        title="No lines yet"
                        hint="Add a product below by EAN or name."
                    >
                        <template #icon
                            ><ClipboardList class="w-6 h-6"
                        /></template>
                    </EmptyState>
                    <div
                        v-else
                        :class="[
                            draftTable.wrap,
                            'rounded-card border border-line',
                        ]"
                    >
                        <table :class="draftTable.table">
                            <thead>
                                <tr :class="draftTable.headRow">
                                    <th scope="col" :class="draftTable.th">
                                        Product
                                    </th>
                                    <th scope="col" :class="draftTable.thNum">
                                        Ordered
                                    </th>
                                    <th
                                        v-if="!isDraft"
                                        scope="col"
                                        :class="draftTable.thNum"
                                    >
                                        Received
                                    </th>
                                    <th
                                        v-if="!isDraft"
                                        scope="col"
                                        :class="draftTable.thNum"
                                    >
                                        Outstanding
                                    </th>
                                    <th scope="col" :class="draftTable.thNum">
                                        Expected cost
                                    </th>
                                    <th
                                        v-if="isDraft"
                                        scope="col"
                                        :class="draftTable.thNum"
                                    >
                                        Action
                                    </th>
                                </tr>
                            </thead>
                            <tbody v-if="isDraft" :class="draftTable.body">
                                <tr
                                    v-for="(line, index) in draft"
                                    :key="line.product"
                                    :class="draftTable.row"
                                >
                                    <td :class="draftTable.tdName">
                                        {{ line.name }}
                                        <span
                                            class="block text-xs font-normal text-muted num"
                                            >{{ line.EAN }}</span
                                        >
                                    </td>
                                    <td :class="draftTable.tdNum">
                                        <BaseInput
                                            v-model="line.quantity"
                                            class="min-w-24"
                                            :data-scan-line="line.product"
                                            numeric
                                            :aria-label="`Ordered quantity (${unitLabel(line.unit)}) for ${line.name}`"
                                            :inputmode="
                                                decimalUnit(line.unit)
                                                    ? 'decimal'
                                                    : 'numeric'
                                            "
                                            :error="lineErrors[index]?.quantity"
                                            :disabled="busy"
                                        />
                                    </td>
                                    <td :class="draftTable.tdNum">
                                        <BaseInput
                                            v-model="line.cost"
                                            class="min-w-28"
                                            numeric
                                            :aria-label="`Expected unit cost (₱/${unitLabel(line.unit)}) for ${line.name}`"
                                            inputmode="decimal"
                                            :error="lineErrors[index]?.cost"
                                            :disabled="busy"
                                        />
                                    </td>
                                    <td :class="draftTable.tdActions">
                                        <BaseButton
                                            size="sm"
                                            variant="outline"
                                            class="min-h-11 min-w-11"
                                            :aria-label="`Remove ${line.name}`"
                                            :disabled="busy"
                                            @click="removeLine(index)"
                                            >Remove</BaseButton
                                        >
                                    </td>
                                </tr>
                            </tbody>
                            <tbody v-else-if="current" :class="draftTable.body">
                                <tr
                                    v-for="line in current.lines"
                                    :key="line._id"
                                    :class="draftTable.row"
                                >
                                    <td :class="draftTable.tdName">
                                        {{ line.name }}
                                        <span
                                            class="block text-xs font-normal text-muted num"
                                            >{{ line.EAN }}</span
                                        >
                                    </td>
                                    <td :class="draftTable.tdNum">
                                        {{
                                            formatQuantity(
                                                line.orderedQty,
                                                line.unit,
                                            )
                                        }}
                                    </td>
                                    <td :class="draftTable.tdNum">
                                        {{
                                            formatQuantity(
                                                line.receivedQty,
                                                line.unit,
                                            )
                                        }}
                                    </td>
                                    <td :class="draftTable.tdNum">
                                        {{
                                            formatQuantity(
                                                line.outstandingQty,
                                                line.unit,
                                            )
                                        }}
                                    </td>
                                    <td :class="draftTable.tdNum">
                                        {{
                                            formatCurrency(line.expectedCost)
                                        }}/{{ unitLabel(line.unit) }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <p class="text-sm text-right font-bold text-ink num">
                        Expected total:
                        {{
                            formatCurrency(
                                isDraft
                                    ? draftTotal(draft)
                                    : (current?.expectedTotal ?? 0),
                            )
                        }}
                    </p>

                    <div v-if="isDraft" class="flex flex-wrap items-end gap-3">
                        <BaseCombobox
                            v-model="searchText"
                            v-model:selected="picked"
                            :options="matchOptions"
                            label="Add product (EAN or name)"
                            :maxlength="STRING_LIMITS.PRODUCT_NAME"
                            :loading="matchesLoading"
                            :error="matchError"
                            :disabled="busy"
                            @search="debouncedSearch"
                        />
                    </div>

                    <div class="flex flex-wrap gap-2">
                        <template v-if="isDraft">
                            <BaseButton :disabled="busy" @click="saveDraft"
                                >Save draft</BaseButton
                            >
                            <BaseButton
                                v-if="current"
                                :disabled="busy || dirty"
                                @click="send"
                                >Mark as sent</BaseButton
                            >
                        </template>
                        <BaseButton
                            v-if="isOpen"
                            :disabled="busy"
                            @click="openReceive"
                            >Receive</BaseButton
                        >
                        <BaseButton
                            v-if="current && (isDraft || isOpen)"
                            variant="outline"
                            :disabled="busy"
                            @click="cancelOrder"
                            >Cancel order</BaseButton
                        >
                    </div>
                    <p
                        v-if="isDraft && current && dirty"
                        class="text-sm text-muted"
                    >
                        Save the draft before marking it as sent.
                    </p>
                </template>
            </div>

            <BaseModal
                v-model="receiving"
                title="Receive purchase order"
                :closable="!busy"
                max-width="48rem"
                scrollable
            >
                <div class="space-y-3">
                    <p class="text-sm text-muted">
                        Enter what arrived, at the invoice's actual unit cost.
                        Leave a quantity blank or 0 to skip a line. Extra goods
                        beyond the outstanding quantity go through a normal
                        restock.
                    </p>
                    <div
                        v-for="(line, index) in receipt"
                        :key="line.line"
                        class="border-t border-line pt-2 space-y-2"
                    >
                        <p class="text-sm font-medium">
                            {{ line.name }} · outstanding
                            <span class="num">{{
                                formatQuantity(line.outstandingQty, line.unit)
                            }}</span>
                        </p>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <BaseInput
                                v-model="line.quantity"
                                :label="`Received (${unitLabel(line.unit)})`"
                                :inputmode="
                                    decimalUnit(line.unit)
                                        ? 'decimal'
                                        : 'numeric'
                                "
                                :error="receiptErrs[index]?.quantity"
                                :disabled="busy"
                            />
                            <BaseInput
                                v-model="line.cost"
                                :label="`Actual unit cost (₱/${unitLabel(line.unit)})`"
                                inputmode="decimal"
                                :error="receiptErrs[index]?.cost"
                                :disabled="busy"
                            />
                        </div>
                        <p class="text-xs text-muted num">
                            Expected {{ formatCurrency(line.expectedCost) }} ·
                            {{ varianceText(line) }}
                        </p>
                        <div
                            v-if="line.tracksExpiry"
                            class="grid grid-cols-1 sm:grid-cols-2 gap-3"
                        >
                            <BaseInput
                                v-model="line.expiryDate"
                                type="date"
                                label="Expiry date (required)"
                                :error="receiptErrs[index]?.expiryDate"
                                :disabled="busy"
                            />
                            <BaseInput
                                v-model="line.batchNo"
                                label="Batch number (optional)"
                                :maxlength="EXPIRY_LIMITS.BATCH_NO"
                                :disabled="busy"
                            />
                        </div>
                    </div>
                    <BaseInput
                        v-model="invoiceNumber"
                        label="Supplier invoice / DR number (optional)"
                        :maxlength="SUPPLIER_LIMITS.INVOICE"
                        :disabled="busy"
                    />
                    <BaseInput
                        v-model="description"
                        label="Description (optional)"
                        :maxlength="STRING_LIMITS.DESCRIPTION"
                        :disabled="busy"
                    />
                    <p
                        v-if="receiveError"
                        role="alert"
                        class="text-sm text-danger-fg"
                    >
                        {{ receiveError }}
                    </p>
                </div>
                <template #footer>
                    <BaseButton
                        variant="outline"
                        :disabled="busy"
                        @click="receiving = false"
                        >Close</BaseButton
                    >
                    <BaseButton
                        class="flex-1"
                        :disabled="busy"
                        @click="submitReceive"
                    >
                        {{ busy ? 'Receiving…' : 'Record receipt' }}
                    </BaseButton>
                </template>
            </BaseModal>
            <ConfirmDialog :request="confirmRequest" @answer="answerConfirm" />
        </PageCard>
    </PageFrame>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import {
    EXPIRY_LIMITS,
    OPEN_PURCHASE_ORDER_STATUSES,
    draftSendBlockers,
    purchaseOrderReference,
    PURCHASE_ORDER_LIMITS,
    PurchaseOrderStatus,
    STRING_LIMITS,
    SUPPLIER_LIMITS,
    formatQuantity,
    parseQuantity,
    quantityInput,
    quantityScale,
    UnitOfMeasure as Unit,
    unitLabel,
    unitOf,
    type Paginated,
    type ProductCostView,
    type PurchaseOrderView,
    type UnitOfMeasure,
} from '@grocery-pos/contracts';
import { useRouter } from 'vue-router';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import PageFrame from '@/components/ui/PageFrame.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import RowOpenButton from '@/components/ui/RowOpenButton.vue';
import StatusBadge from '@/components/ui/StatusBadge.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import SegmentedFilter from '@/components/ui/SegmentedFilter.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import {
    useAppliedFilters,
    useListFetch,
    useListPaging,
} from '@/composables/useListFetch';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseCombobox from '@/components/ui/BaseCombobox.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import type { ComboboxOption } from '@/components/ui/types';
import EmptyState from '@/components/ui/EmptyState.vue';
import { draftTable } from '@/components/ui/draft-table';
import type { Breadcrumb } from '@/components/ui/page-primitives';
import { ClipboardList } from '@lucide/vue';
import SupplierSelect from '@/components/User/Supplier/SupplierSelect.vue';
import { zeroCostRequest } from '@/components/User/Restock/validation';
import {
    STATUS_LABELS,
    PURCHASE_ORDER_STATUS,
    costVariance,
    draftLineErrors,
    draftLinesOf,
    draftTotal,
    newReceiveKey,
    receiptErrors,
    receiptForm,
    receivedLines,
    toPurchaseOrderBody,
    toReceiveBody,
    type PurchaseOrderDraftLine,
    type ReceiptFormLine,
    PURCHASE_ORDER_HELP,
} from '@/components/User/PurchaseOrder/purchase-order';
import { useConfirm } from '@/composables/useConfirm';
import { useUnsavedDraftsGuard } from '@/composables/useDrafts';
import { useProductMatches } from '@/composables/useProductMatches';
import {
    lookupActiveBarcode,
    useBarcodeCapture,
} from '@/composables/useBarcodeCapture';
import { usePurchaseOrderPrefillStore } from '@/stores/purchaseOrderPrefill';
import { Color, useUIStore } from '@/stores/ui';
import {
    centavosToPesoInput,
    formatCurrency,
    parsePesos,
} from '@/utils/currency';
import { apiErrorBody, apiErrorText } from '@/utils/api-error';

const ui = useUIStore();
const {
    request: confirmRequest,
    confirm,
    answer: answerConfirm,
} = useConfirm();

let unmounted = false;
onBeforeUnmount(() => {
    unmounted = true;
});

// ---------------------------------------------------------------- list
const headers = [
    { key: 'reference', title: 'Order' },
    { key: 'createdAt', title: 'Created' },
    { key: 'supplier', title: 'Supplier' },
    { key: 'status', title: 'Status', help: PURCHASE_ORDER_HELP.status },
    {
        key: 'lines',
        title: 'Lines',
        align: 'right' as const,
        help: PURCHASE_ORDER_HELP.lines,
    },
    {
        key: 'expectedTotal',
        title: 'Expected total',
        align: 'right' as const,
        help: PURCHASE_ORDER_HELP.expectedTotal,
    },
    { key: 'action', title: 'Open', align: 'right' as const },
];
const rows = ref<PurchaseOrderView[]>([]);
const totalItems = ref(0);
// Chips (#261): '' is "All" (SegmentedFilter has no null) and sends no status.
const statusFilter = ref<PurchaseOrderStatus | ''>('');
const statusOptions = [
    { label: 'All', value: '' as const },
    ...Object.values(PurchaseOrderStatus).map((value) => ({
        label: STATUS_LABELS[value],
        value,
    })),
];
const { page, limit, search } = useListPaging(() => load(), 10);
const { applied, apply } = useAppliedFilters(
    () => ({ status: statusFilter.value }),
    search,
);
const {
    loading: listLoading,
    error: listError,
    load,
} = useListFetch(
    () =>
        api.get<Paginated<PurchaseOrderView>>('/purchase-orders', {
            params: {
                page: page.value,
                limit: limit.value,
                ...(applied.value.status && { status: applied.value.status }),
            },
        }),
    (result) => {
        rows.value = result.data.data;
        totalItems.value = result.data.totalItems;
    },
    'Unable to load purchase orders.',
);

function supplierLabel(po: PurchaseOrderView) {
    if (!po.supplier) return 'Unknown supplier';
    return po.supplier.isActive
        ? po.supplier.name
        : `${po.supplier.name} (archived)`;
}
function formatDate(value: string) {
    return new Date(value).toLocaleString();
}
function decimalUnit(unit?: UnitOfMeasure) {
    return quantityScale(unit) === 1000;
}

// ---------------------------------------------------------------- editor
const editing = ref(false);
const current = ref<PurchaseOrderView | null>(null);
const supplier = ref<string | number | null>('');
const note = ref('');
const draft = ref<PurchaseOrderDraftLine[]>([]);
const saved = ref('');
const busy = ref(false);
const validation = ref('');
const lineErrors = ref<Record<number, Record<string, string>>>({});

const isDraft = computed(
    () =>
        editing.value &&
        (!current.value || current.value.status === PurchaseOrderStatus.DRAFT),
);
const blockers = computed(() =>
    current.value ? draftSendBlockers(current.value) : [],
);
const router = useRouter();
function viewReceipts(id: string) {
    void router.push({ name: 'Restocks', query: { purchaseOrder: id } });
}
/**
 * The editor's trail (#173): Purchase orders › its reference (or "New").
 * The list crumb is text, not a link: "Back to list" leaves the editor,
 * through its unsaved-changes question.
 */
const breadcrumbs = computed<Breadcrumb[] | undefined>(() =>
    editing.value
        ? [
              { label: 'Purchase orders' },
              {
                  label: current.value
                      ? purchaseOrderReference(current.value._id)
                      : 'New purchase order',
              },
          ]
        : undefined,
);
const isOpen = computed(
    () =>
        !!current.value &&
        OPEN_PURCHASE_ORDER_STATUSES.includes(current.value.status),
);
const snapshot = () =>
    JSON.stringify({ s: supplier.value, n: note.value, d: draft.value });
const dirty = computed(() => isDraft.value && snapshot() !== saved.value);

useUnsavedDraftsGuard({
    count: () => (dirty.value ? Math.max(1, draft.value.length) : 0),
    saving: () => busy.value,
    confirm,
});

function show(po: PurchaseOrderView | null, lines: PurchaseOrderDraftLine[]) {
    current.value = po;
    supplier.value = po?.supplier?._id ?? '';
    note.value = po?.note ?? '';
    draft.value = lines;
    validation.value = '';
    lineErrors.value = {};
    saved.value = po ? snapshot() : JSON.stringify({ s: '', n: '', d: [] });
    editing.value = true;
}
function startNew(lines: PurchaseOrderDraftLine[]) {
    show(null, lines);
}
function open(po: PurchaseOrderView) {
    show(po, draftLinesOf(po));
}
async function closeEditor() {
    if (
        dirty.value &&
        !(await confirm({
            title: 'Discard changes?',
            message: 'The purchase order draft has unsaved changes.',
            confirmLabel: 'Discard',
            danger: true,
        }))
    )
        return;
    editing.value = false;
    current.value = null;
    draft.value = [];
    void load();
}
function removeLine(index: number) {
    draft.value = draft.value.filter((_, i) => i !== index);
    lineErrors.value = {};
}

const {
    matches,
    options: matchOptions,
    loading: matchesLoading,
    error: matchError,
    debouncedSearch,
    reset: resetMatches,
} = useProductMatches();
const searchText = ref('');
const picked = computed<ComboboxOption | null>({
    get: () => null,
    set: (option) => {
        if (!option) return;
        const match = matches.value.find((m) => m.product === option.value);
        if (!match) return;
        searchText.value = '';
        resetMatches();
        if (draft.value.some((line) => line.product === match.product)) {
            validation.value = `${match.name} is already on this order.`;
            return;
        }
        validation.value = '';
        const line: PurchaseOrderDraftLine = {
            product: match.product,
            name: match.name,
            EAN: match.EAN,
            unit: unitOf(match.unit),
            tracksExpiry: match.tracksExpiry,
            quantity: '',
            cost: '',
        };
        draft.value = [...draft.value, line];
        void prefillCosts([line]);
    },
});

/** Focuses a draft line's ordered quantity field. */
async function focusQuantity(product: string) {
    await nextTick();
    [...document.querySelectorAll<HTMLInputElement>('input[data-scan-line]')]
        .find((el) => el.dataset.scanLine === product)
        ?.focus();
}

/**
 * A page-wide scan on a DRAFT (#214): adds the product as a line, or +1
 * displayed unit when it is already on the order. A measured unit
 * (KG/G/L) is never counted up: its quantity field takes the focus so the
 * weight is typed. Locked orders ignore scans.
 */
async function onScan(code: string) {
    let found;
    try {
        found = await lookupActiveBarcode(code);
    } catch (cause) {
        if (!unmounted)
            ui.queueMessage(
                Color.ERROR,
                apiErrorText(cause, 'Could not look up the barcode.'),
            );
        return;
    }
    if (unmounted || !isDraft.value || busy.value) return;
    if (found.kind === 'archived') {
        ui.queueMessage(Color.ERROR, 'Product archived');
        return;
    }
    if (found.kind === 'unknown') {
        ui.queueMessage(Color.ERROR, 'Product not found');
        return;
    }
    const product = found.product;
    const unit = unitOf(product.unit);
    const piece = unit === Unit.PIECE;
    validation.value = '';
    const existing = draft.value.find((line) => line.product === product._id);
    if (existing) {
        const qty = parseQuantity(existing.quantity, unit);
        if (piece && (existing.quantity.trim() === '' || qty !== null))
            existing.quantity = quantityInput((qty ?? 0) + 1, unit);
        else await focusQuantity(product._id);
        return;
    }
    const line: PurchaseOrderDraftLine = {
        product: product._id,
        name: product.name,
        EAN: product.EAN,
        unit,
        tracksExpiry: product.tracksExpiry,
        quantity: piece ? '1' : '',
        cost: '',
    };
    draft.value = [...draft.value, line];
    void prefillCosts([line]);
    if (!piece) await focusQuantity(product._id);
}
// Scans apply one at a time, in order: two quick scans of a new product
// make one line of 2, never two lines (#214 review).
let scans: Promise<void> = Promise.resolve();
useBarcodeCapture(
    (code) => {
        scans = scans.then(() => onScan(code));
    },
    { enabled: () => isDraft.value && !busy.value },
);

/** Known latest costs fill untouched lines only, never an edit (#41, #123). */
async function prefillCosts(lines: PurchaseOrderDraftLine[]) {
    if (!lines.length) return;
    const before = new Map(lines.map((l) => [l.product, l.cost]));
    try {
        const result = await api.get<ProductCostView[]>('/suppliers/costs', {
            params: { products: lines.map((l) => l.product).join(',') },
        });
        if (unmounted) return;
        for (const row of result.data) {
            const line = draft.value.find((l) => l.product === row.product);
            if (!line || row.lastCost === undefined) continue;
            if (line.cost !== before.get(row.product)) continue;
            const wasSaved = !dirty.value;
            line.cost = centavosToPesoInput(row.lastCost);
            if (wasSaved) saved.value = snapshot();
        }
    } catch (cause) {
        if (!unmounted)
            ui.queueMessage(
                Color.ERROR,
                apiErrorText(
                    cause,
                    'Cost defaults unavailable. Enter expected costs.',
                ),
            );
    }
}

function checkDraft(): boolean {
    validation.value = '';
    lineErrors.value = draftLineErrors(draft.value);
    if (!supplier.value) validation.value = 'Choose an active supplier.';
    else if (!draft.value.length)
        validation.value = 'Add at least one product.';
    else if (Object.keys(lineErrors.value).length)
        validation.value = 'Fix the highlighted lines.';
    return !validation.value;
}

async function saveDraft() {
    if (busy.value || !checkDraft()) return;
    busy.value = true;
    const body = toPurchaseOrderBody(
        String(supplier.value),
        note.value,
        draft.value,
    );
    try {
        const result = current.value
            ? await api.patch<PurchaseOrderView>(
                  `/purchase-orders/${current.value._id}`,
                  { ...body, version: current.value.version },
              )
            : await api.post<PurchaseOrderView>('/purchase-orders', body);
        if (unmounted) return;
        show(result.data, draftLinesOf(result.data));
        ui.queueMessage(Color.SUCCESS, 'Purchase order draft saved.');
    } catch (cause) {
        if (!unmounted) ui.queueMessage(Color.ERROR, apiErrorText(cause));
    } finally {
        busy.value = false;
    }
}

async function transition(path: 'send' | 'cancel', success: string) {
    const po = current.value;
    if (!po || busy.value) return;
    busy.value = true;
    try {
        const result = await api.post<PurchaseOrderView>(
            `/purchase-orders/${po._id}/${path}`,
            { version: po.version },
        );
        if (unmounted) return;
        show(result.data, draftLinesOf(result.data));
        ui.queueMessage(Color.SUCCESS, success);
    } catch (cause) {
        if (unmounted) return;
        ui.queueMessage(Color.ERROR, apiErrorText(cause));
        await reloadOnConflict(cause);
    } finally {
        busy.value = false;
    }
}

/** After a 409 the order changed elsewhere: show its current state. */
async function reloadOnConflict(
    cause: unknown,
    notice = 'Purchase order reloaded.',
): Promise<boolean> {
    const po = current.value;
    if (!po || apiErrorBody(cause)?.statusCode !== 409) return false;
    try {
        const fresh = await api.get<PurchaseOrderView>(
            `/purchase-orders/${po._id}`,
        );
        if (unmounted || current.value?._id !== po._id) return false;
        show(fresh.data, draftLinesOf(fresh.data));
        ui.queueMessage(Color.INFO, notice);
        return true;
    } catch {
        return false;
    }
}
async function send() {
    if (
        await confirm({
            title: 'Mark as sent?',
            message:
                'Its lines are locked once sent. To change it later, cancel it and create a new order.',
            confirmLabel: 'Mark as sent',
        })
    )
        await transition('send', 'Purchase order marked as sent.');
}
async function cancelOrder() {
    const partial =
        current.value?.status === PurchaseOrderStatus.PARTIALLY_RECEIVED;
    if (
        await confirm({
            title: 'Cancel purchase order?',
            message: partial
                ? 'Received stock stays. The remaining quantities are closed as short.'
                : 'It stays in the history as cancelled.',
            confirmLabel: 'Cancel order',
            cancelLabel: 'Keep it',
            danger: true,
        })
    )
        await transition('cancel', 'Purchase order cancelled.');
}

// ---------------------------------------------------------------- receive
const receiving = ref(false);
const receipt = ref<ReceiptFormLine[]>([]);
const receiptErrs = ref<Record<number, Record<string, string>>>({});
const invoiceNumber = ref('');
const description = ref('');
const receiveError = ref('');
/**
 * The receive attempt's key and the body it was sent with. Like the
 * register's checkout attempt, the key is reused only for an unchanged
 * body (a retry after a lost answer replays); any edit makes a new one.
 */
let receiveKey = '';
let keySignature = '';

function openReceive() {
    if (!current.value) return;
    receipt.value = receiptForm(current.value);
    receiptErrs.value = {};
    invoiceNumber.value = '';
    description.value = '';
    receiveError.value = '';
    receiveKey = '';
    keySignature = '';
    receiving.value = true;
}
function varianceText(line: ReceiptFormLine) {
    const variance = costVariance(line);
    if (variance === null) return 'enter the actual cost';
    if (variance === 0) return 'no cost variance';
    return `variance ${variance > 0 ? '+' : '−'}${formatCurrency(Math.abs(variance))}`;
}
async function submitReceive() {
    const po = current.value;
    if (!po || busy.value) return;
    receiveError.value = '';
    receiptErrs.value = receiptErrors(receipt.value);
    if (Object.keys(receiptErrs.value).length) {
        receiveError.value = 'Fix the highlighted lines.';
        return;
    }
    const lines = receivedLines(receipt.value);
    if (!lines.length) {
        receiveError.value = 'Enter a received quantity on at least one line.';
        return;
    }
    const zero = zeroCostRequest(
        lines.map((line) => ({
            unitCost: parsePesos(line.cost) ?? -1,
            name: line.name,
            EAN: line.EAN,
        })),
    );
    if (zero && !(await confirm(zero))) return;
    const body = toReceiveBody(
        po,
        '',
        receipt.value,
        invoiceNumber.value,
        description.value,
    );
    const signature = JSON.stringify(body);
    if (!receiveKey || signature !== keySignature) {
        receiveKey = newReceiveKey();
        keySignature = signature;
    }
    busy.value = true;
    try {
        const result = await api.post<PurchaseOrderView>(
            `/purchase-orders/${po._id}/receive`,
            { ...body, idempotencyKey: receiveKey },
        );
        if (unmounted) return;
        receiving.value = false;
        show(result.data, draftLinesOf(result.data));
        ui.queueMessage(Color.SUCCESS, 'Receipt recorded.');
    } catch (cause) {
        if (unmounted) return;
        // A definite refusal never applied, so the next attempt is new; a
        // lost answer keeps the key so an unchanged retry replays.
        if (apiErrorBody(cause)) receiveKey = '';
        receiveError.value = apiErrorText(cause);
        if (
            await reloadOnConflict(
                cause,
                'Purchase order reloaded. The receipt you entered was not recorded; enter it again.',
            )
        )
            receiving.value = false;
    } finally {
        busy.value = false;
    }
}

// ---------------------------------------------------------------- start
const prefilled = usePurchaseOrderPrefillStore().take();
if (prefilled.length) {
    startNew(prefilled);
    ui.queueMessage(
        Color.INFO,
        'Choose a supplier and review quantities and expected costs before saving.',
    );
    void prefillCosts(prefilled);
}
const deepLink = router.currentRoute?.value.query.id;
// The open order is in the address as `?id=` (#143), so it can be
// bookmarked or shared; replace, so opening orders adds no history.
watch(
    () => (editing.value ? current.value?._id : undefined),
    (id) => {
        const query = { ...(router.currentRoute?.value.query ?? {}) };
        if ((query.id ?? undefined) === id) return;
        if (id) query.id = id;
        else delete query.id;
        void router.replace({ query });
    },
);
if (
    !prefilled.length &&
    typeof deepLink === 'string' &&
    /^[a-f0-9]{24}$/i.test(deepLink)
)
    void api
        .get<PurchaseOrderView>(`/purchase-orders/${deepLink}`)
        .then((result) => {
            if (!unmounted && !editing.value) open(result.data);
        })
        .catch((cause) => {
            if (!unmounted) ui.queueMessage(Color.ERROR, apiErrorText(cause));
        });
void load();
</script>
