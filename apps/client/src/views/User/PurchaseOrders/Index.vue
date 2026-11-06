<template>
    <PageCard title="Purchase orders">
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
        <div class="space-y-4 p-5">
            <template v-if="!editing">
                <div class="flex flex-wrap items-end gap-3">
                    <BaseSelect
                        v-model="statusFilter"
                        label="Status"
                        all-label="All statuses"
                        :options="statusOptions"
                        @update:model-value="search"
                    />
                </div>
                <p v-if="listError" role="alert" class="text-red-700">
                    {{ listError }}
                    <BaseButton @click="load">Retry</BaseButton>
                </p>
                <p v-if="listLoading">Loading purchase orders…</p>
                <table class="w-full text-sm">
                    <thead>
                        <tr>
                            <th class="text-left">Created</th>
                            <th class="text-left">Supplier</th>
                            <th>Status</th>
                            <th>Lines</th>
                            <th class="text-right">Expected total</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in rows" :key="row._id" class="border-t">
                            <td>{{ formatDate(row.createdAt) }}</td>
                            <td>{{ supplierLabel(row) }}</td>
                            <td class="text-center">
                                {{ STATUS_LABELS[row.status] }}
                            </td>
                            <td class="text-center">{{ row.lines.length }}</td>
                            <td class="text-right">
                                {{ formatCurrency(row.expectedTotal) }}
                            </td>
                            <td class="text-center py-1">
                                <BaseButton size="sm" @click="open(row)"
                                    >Open</BaseButton
                                >
                            </td>
                        </tr>
                        <tr v-if="!rows.length && !listLoading && !listError">
                            <td
                                colspan="6"
                                class="py-6 text-center text-slate-500"
                            >
                                No purchase orders.
                            </td>
                        </tr>
                    </tbody>
                </table>
                <div v-if="!listError" class="flex items-center gap-3">
                    <BaseButton
                        size="sm"
                        variant="outline"
                        :disabled="page <= 1 || listLoading"
                        @click="goPage(page - 1)"
                        >Previous</BaseButton
                    >
                    <span class="text-sm">Page {{ page }} of {{ pages }}</span>
                    <BaseButton
                        size="sm"
                        variant="outline"
                        :disabled="page >= pages || listLoading"
                        @click="goPage(page + 1)"
                        >Next</BaseButton
                    >
                </div>
            </template>

            <template v-else>
                <div v-if="current" class="text-sm text-slate-700 space-y-1">
                    <p>
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
                <p v-if="validation" role="alert" class="text-sm text-red-700">
                    {{ validation }}
                </p>

                <table class="w-full text-sm">
                    <thead>
                        <tr>
                            <th class="text-left">Product</th>
                            <th class="text-right">Ordered</th>
                            <th v-if="!isDraft" class="text-right">Received</th>
                            <th v-if="!isDraft" class="text-right">
                                Outstanding
                            </th>
                            <th class="text-right">Expected cost</th>
                            <th v-if="isDraft">Action</th>
                        </tr>
                    </thead>
                    <tbody v-if="isDraft">
                        <tr
                            v-for="(line, index) in draft"
                            :key="line.product"
                            class="border-t"
                        >
                            <td>{{ line.name }} ({{ line.EAN }})</td>
                            <td class="text-right">
                                <BaseInput
                                    v-model="line.quantity"
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
                            <td class="text-right">
                                <BaseInput
                                    v-model="line.cost"
                                    :aria-label="`Expected unit cost (₱/${unitLabel(line.unit)}) for ${line.name}`"
                                    inputmode="decimal"
                                    :error="lineErrors[index]?.cost"
                                    :disabled="busy"
                                />
                            </td>
                            <td class="text-center">
                                <BaseButton
                                    size="sm"
                                    variant="outline"
                                    :disabled="busy"
                                    @click="removeLine(index)"
                                    >Remove</BaseButton
                                >
                            </td>
                        </tr>
                    </tbody>
                    <tbody v-else-if="current">
                        <tr
                            v-for="line in current.lines"
                            :key="line._id"
                            class="border-t"
                        >
                            <td>{{ line.name }} ({{ line.EAN }})</td>
                            <td class="text-right">
                                {{ formatQuantity(line.orderedQty, line.unit) }}
                            </td>
                            <td class="text-right">
                                {{
                                    formatQuantity(line.receivedQty, line.unit)
                                }}
                            </td>
                            <td class="text-right">
                                {{
                                    formatQuantity(
                                        line.outstandingQty,
                                        line.unit,
                                    )
                                }}
                            </td>
                            <td class="text-right">
                                {{ formatCurrency(line.expectedCost) }}/{{
                                    unitLabel(line.unit)
                                }}
                            </td>
                        </tr>
                    </tbody>
                </table>
                <p class="text-sm text-right font-bold">
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
                    class="text-sm text-slate-600"
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
                <p class="text-sm text-slate-600">
                    Enter what arrived, at the invoice's actual unit cost. Leave
                    a quantity blank or 0 to skip a line. Extra goods beyond the
                    outstanding quantity go through a normal restock.
                </p>
                <div
                    v-for="(line, index) in receipt"
                    :key="line.line"
                    class="border-t pt-2 space-y-2"
                >
                    <p class="text-sm font-medium">
                        {{ line.name }} · outstanding
                        {{ formatQuantity(line.outstandingQty, line.unit) }}
                    </p>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <BaseInput
                            v-model="line.quantity"
                            :label="`Received (${unitLabel(line.unit)})`"
                            :inputmode="
                                decimalUnit(line.unit) ? 'decimal' : 'numeric'
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
                    <p class="text-xs text-slate-600">
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
                    class="text-sm text-red-700"
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
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import {
    EXPIRY_LIMITS,
    OPEN_PURCHASE_ORDER_STATUSES,
    PURCHASE_ORDER_LIMITS,
    PurchaseOrderStatus,
    STRING_LIMITS,
    SUPPLIER_LIMITS,
    formatQuantity,
    quantityScale,
    unitLabel,
    unitOf,
    type Paginated,
    type ProductCostView,
    type PurchaseOrderView,
    type UnitOfMeasure,
} from '@grocery-pos/contracts';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseCombobox from '@/components/ui/BaseCombobox.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import type { ComboboxOption } from '@/components/ui/types';
import SupplierSelect from '@/components/User/Supplier/SupplierSelect.vue';
import { zeroCostRequest } from '@/components/User/Restock/validation';
import {
    STATUS_LABELS,
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
} from '@/components/User/PurchaseOrder/purchase-order';
import { useConfirm } from '@/composables/useConfirm';
import { useUnsavedDraftsGuard } from '@/composables/useDrafts';
import { useProductMatches } from '@/composables/useProductMatches';
import { usePurchaseOrderPrefillStore } from '@/stores/purchaseOrderPrefill';
import { Color, useUIStore } from '@/stores/ui';
import {
    centavosToPesoInput,
    formatCurrency,
    parsePesos,
} from '@/utils/currency';
import { apiErrorBody, apiErrorText } from '@/utils/api-error';

const LIMIT = 20;
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
const rows = ref<PurchaseOrderView[]>([]);
const totalItems = ref(0);
const page = ref(1);
const statusFilter = ref<string | number | null>(null);
const listLoading = ref(false);
const listError = ref('');
const pages = computed(() => Math.max(1, Math.ceil(totalItems.value / LIMIT)));
const statusOptions = Object.values(PurchaseOrderStatus).map((value) => ({
    label: STATUS_LABELS[value],
    value,
}));
let listGeneration = 0;
async function load() {
    const generation = ++listGeneration;
    listLoading.value = true;
    listError.value = '';
    try {
        const result = await api.get<Paginated<PurchaseOrderView>>(
            '/purchase-orders',
            {
                params: {
                    page: page.value,
                    limit: LIMIT,
                    ...(statusFilter.value && { status: statusFilter.value }),
                },
            },
        );
        if (generation !== listGeneration) return;
        rows.value = result.data.data;
        totalItems.value = result.data.totalItems;
    } catch (cause) {
        if (generation === listGeneration)
            listError.value = apiErrorText(
                cause,
                'Unable to load purchase orders.',
            );
    } finally {
        if (generation === listGeneration) listLoading.value = false;
    }
}
function search() {
    page.value = 1;
    void load();
}
function goPage(next: number) {
    page.value = next;
    void load();
}

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
        if (!unmounted) ui.queueMessage(Color.ERROR, apiErrorText(cause));
    } finally {
        busy.value = false;
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
let receiveKey = '';

function openReceive() {
    if (!current.value) return;
    receipt.value = receiptForm(current.value);
    receiptErrs.value = {};
    invoiceNumber.value = '';
    description.value = '';
    receiveError.value = '';
    receiveKey = newReceiveKey();
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
    busy.value = true;
    try {
        const result = await api.post<PurchaseOrderView>(
            `/purchase-orders/${po._id}/receive`,
            toReceiveBody(
                po,
                receiveKey,
                receipt.value,
                invoiceNumber.value,
                description.value,
            ),
        );
        if (unmounted) return;
        receiving.value = false;
        show(result.data, draftLinesOf(result.data));
        ui.queueMessage(Color.SUCCESS, 'Receipt recorded.');
    } catch (cause) {
        if (unmounted) return;
        // A definite refusal never applied, so the next attempt is new; a
        // lost answer keeps the key so a retry replays instead of doubling.
        if (apiErrorBody(cause)) receiveKey = newReceiveKey();
        receiveError.value = apiErrorText(cause);
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
void load();
</script>
