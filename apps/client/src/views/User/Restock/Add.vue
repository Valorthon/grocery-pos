<template>
    <PageFrame>
        <template #actions>
            <BaseButton size="sm" @click="openAddDialog">
                <Plus class="w-4 h-4" />
                Add Product
            </BaseButton>
            <BaseButton
                size="sm"
                variant="outline"
                :disabled="costDefaultsPending"
                @click="openSaveDialog"
            >
                <Save class="w-4 h-4" />
                Save
            </BaseButton>
        </template>
        <PageCard>
            <div
                class="px-5 py-4 bg-paper border-b border-line grid grid-cols-1 md:grid-cols-4 gap-3"
            >
                <BaseInput
                    v-model="search"
                    label="Search restocked products..."
                    clearable
                    class="md:col-span-3"
                />
                <div class="flex items-end">
                    <BaseButton
                        variant="outline"
                        size="sm"
                        block
                        :disabled="items.length === 0"
                        @click="confirmClear"
                    >
                        <Trash2 class="w-4 h-4" />
                        Clear Drafts
                    </BaseButton>
                </div>
            </div>

            <EmptyState
                v-if="filteredItems.length === 0"
                :title="
                    items.length ? 'No matching drafts' : 'No restock lines yet'
                "
                :hint="
                    items.length
                        ? 'No draft matches the search.'
                        : 'Click &quot;Add Product&quot; to add a line for each product received.'
                "
            >
                <template #icon><PackagePlus class="w-6 h-6" /></template>
            </EmptyState>
            <div v-else :class="draftTable.wrap">
                <table :class="draftTable.table">
                    <thead>
                        <tr :class="draftTable.headRow">
                            <th scope="col" :class="draftTable.th">Name</th>
                            <th scope="col" :class="draftTable.thNum">
                                Quantity
                            </th>
                            <th scope="col" :class="draftTable.thNum">
                                Unit Cost
                            </th>
                            <th scope="col" :class="draftTable.thNum">
                                Total Cost
                            </th>
                            <th scope="col" :class="draftTable.thNum">
                                Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody :class="draftTable.body">
                        <tr
                            v-for="item in filteredItems"
                            :key="item.draftId"
                            :class="draftTable.row"
                        >
                            <td :class="draftTable.tdName">
                                {{ item.name }}
                            </td>
                            <td :class="draftTable.tdNum">
                                {{ formatQuantity(item.quantity, item.unit) }}
                            </td>
                            <td :class="draftTable.tdNum">
                                {{ formatCurrency(item.unitCost ?? 0) }}
                            </td>
                            <td :class="[draftTable.tdNum, 'font-bold']">
                                {{
                                    formatCurrency(
                                        quantityAmount(
                                            item.unitCost ?? 0,
                                            item.quantity ?? 0,
                                            item.unit,
                                        ),
                                    )
                                }}
                            </td>
                            <td :class="draftTable.tdActions">
                                <DraftRowActions
                                    :edit-label="`Edit draft ${item.name}`"
                                    :delete-label="`Delete draft ${item.name}`"
                                    @edit="editDraft(item)"
                                    @delete="deleteDraft(item)"
                                />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </PageCard>
    </PageFrame>

    <RestockAddDialog
        v-model="isAddDialogOpen"
        :item="editItem"
        :scanned="scanned"
        @add="handleNewItem"
        @update="handleUpdateItem"
    />

    <RestockSaveDialog v-model="isSaveDialogOpen" :save="saveToDB" />

    <ConfirmDialog :request="confirmRequest" @answer="answerConfirm" />
</template>

<script setup lang="ts">
import {
    formatQuantity,
    quantityAmount,
    type ProductCostView,
} from '@grocery-pos/contracts';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import { PackagePlus, Plus, Save, Trash2 } from '@lucide/vue';
import DraftRowActions from '@/components/ui/DraftRowActions.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import { draftTable } from '@/components/ui/draft-table';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import PageFrame from '@/components/ui/PageFrame.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import RestockAddDialog from '@/components/User/Restock/AddDialog.vue';
import RestockSaveDialog from '@/components/User/Restock/SaveDialog.vue';
import { AddForm, SaveForm } from '@/components/User/Restock/dto';
import { zeroCostRequest } from '@/components/User/Restock/validation';
import { Color, useUIStore } from '@/stores/ui';
import { formatCurrency } from '@/utils/currency';
import { apiErrorMessages } from '@/utils/api-error';
import { isExpiryDate } from '@grocery-pos/contracts';
import { newProductLines, toRestockBody } from '@/utils/payloads';
import { useRestockPrefillStore } from '@/stores/restockPrefill';
import { useConfirm } from '@/composables/useConfirm';
import {
    lookupActiveBarcode,
    useBarcodeCapture,
    type ScannedLine,
} from '@/composables/useBarcodeCapture';
import { barcodeError } from '@grocery-pos/contracts';
import {
    clearDraftsRequest,
    useDraftList,
    useUnsavedDraftsGuard,
    type WithDraftId,
} from '@/composables/useDrafts';

type Row = WithDraftId<AddForm>;

const NOTHING_TO_SAVE = 'No restock lines to save';

const isAddDialogOpen = ref(false);
const isSaveDialogOpen = ref(false);
const search = ref('');
const { items, add, replace, remove, clear } = useDraftList<AddForm>();
const editItem = ref<AddForm>();
const editingId = ref<string | null>(null);
/** True while the save request is in flight (the save dialog is busy). */
const saving = ref(false);

const uiStore = useUIStore();
const prefilled = useRestockPrefillStore().take();
const costDefaultsPending = ref(prefilled.length > 0);
for (const line of prefilled) add(line);
if (prefilled.length)
    uiStore.queueMessage(
        Color.INFO,
        'Review restock quantities and enter the actual unit costs before saving.',
    );
const router = useRouter();

const {
    request: confirmRequest,
    confirm,
    answer: answerConfirm,
} = useConfirm();
useUnsavedDraftsGuard({
    count: () => items.value.length,
    saving: () => saving.value,
    confirm,
});

// A save that settles after the page is gone (only a forced logout can
// take it away mid-save) must not navigate or report here.
let unmounted = false;
onBeforeUnmount(() => {
    unmounted = true;
});

// Only untouched imported drafts receive a procurement default; no selling price fallback.
if (prefilled.length) {
    const snapshots = items.value.map((line) => ({ ...line }));
    void api
        .get<ProductCostView[]>('/suppliers/costs', {
            params: {
                products: prefilled
                    .filter((line) => !line.isNewProduct)
                    .map((line) => line.product)
                    .join(','),
            },
        })
        .then((response) => {
            if (unmounted) return;
            for (const snapshot of snapshots) {
                const current = items.value.find(
                    (line) => line.draftId === snapshot.draftId,
                );
                if (
                    !current ||
                    JSON.stringify(current) !== JSON.stringify(snapshot) ||
                    current.isNewProduct
                )
                    continue;
                const cost = response.data.find(
                    (row) => row.product === current.product,
                )?.lastCost;
                if (cost !== undefined)
                    replace(current.draftId, {
                        ...current,
                        unitCost: cost,
                        totalCost: quantityAmount(
                            cost,
                            current.quantity,
                            current.unit,
                        ),
                    });
            }
        })
        .catch((cause) => {
            if (!unmounted)
                uiStore.queueMessage(
                    Color.ERROR,
                    apiErrorMessages(
                        cause,
                        'Cost defaults unavailable. Review actual unit costs before saving.',
                    ),
                );
        })
        .finally(() => {
            costDefaultsPending.value = false;
        });
}

const filteredItems = computed(() => {
    const q = search.value.trim().toLowerCase();
    if (!q) return items.value;
    return items.value.filter(
        (i) =>
            i.name?.toLowerCase().includes(q) ||
            i.EAN?.toLowerCase().includes(q),
    );
});

/**
 * An empty restock is never sent: say so instead of asking for details.
 * Lines at a ₱0 unit cost are named and confirmed first (#85); "Go back"
 * keeps every draft as it is.
 */
const openSaveDialog = async () => {
    if (costDefaultsPending.value) return;
    if (items.value.length === 0) {
        uiStore.queueMessage(Color.ERROR, NOTHING_TO_SAVE);
        return;
    }
    const zeroCost = zeroCostRequest(items.value);
    if (zeroCost && !(await confirm(zeroCost))) return;
    isSaveDialogOpen.value = true;
};

/** The save dialog waits on this and closes only when it is true. */
const saveToDB = async (saveForm: SaveForm): Promise<boolean> => {
    if (items.value.length === 0) {
        uiStore.queueMessage(Color.ERROR, NOTHING_TO_SAVE);
        return false;
    }
    if (
        items.value.some(
            (line) => line.tracksExpiry && !isExpiryDate(line.expiryDate),
        )
    ) {
        uiStore.queueMessage(
            Color.ERROR,
            'Edit each expiry-tracked line and choose its expiry date before saving.',
        );
        return false;
    }
    // The API numbers insert errors among the new products only.
    const newLines = newProductLines(items.value);
    saving.value = true;
    try {
        await api.post(
            '/restocks',
            toRestockBody(
                items.value,
                saveForm.description,
                saveForm.supplier,
                saveForm.invoiceNumber,
            ),
        );
    } catch (error) {
        if (unmounted) return false;
        uiStore.queueMessage(
            Color.ERROR,
            apiErrorMessages(error, 'Error saving. Try again.', {
                insertLine: (index) => newLines[index] ?? index,
            }),
        );
        return false;
    } finally {
        saving.value = false;
    }

    if (unmounted) return true;
    // Saved: nothing is left unsaved, so the leave guard lets this go.
    clear();
    uiStore.queueMessage(Color.SUCCESS, 'Restock saved.');
    void router.push({ name: 'Restocks' });
    return true;
};

/** The scan the add dialog opens with; undefined for a plain Add. */
const scanned = ref<ScannedLine>();

function openScanned(line: ScannedLine) {
    if (unmounted || isAddDialogOpen.value) return;
    editItem.value = undefined;
    editingId.value = null;
    scanned.value = line;
    isAddDialogOpen.value = true;
}

/**
 * A page-wide scan (#214) opens the add dialog for a new line with the
 * product filled in. Archived products are refused.
 */
async function onScan(code: string) {
    try {
        const found = await lookupActiveBarcode(code);
        if (unmounted) return;
        if (found.kind === 'found') openScanned({ product: found.product });
        else if (found.kind === 'archived')
            uiStore.queueMessage(Color.ERROR, 'Product archived');
        else {
            const invalid = barcodeError(code);
            if (invalid) uiStore.queueMessage(Color.ERROR, invalid);
            else openScanned({ EAN: code });
        }
    } catch (error) {
        if (!unmounted)
            uiStore.queueMessage(
                Color.ERROR,
                apiErrorMessages(error, 'Could not look up the barcode.'),
            );
    }
}
useBarcodeCapture((code) => void onScan(code), {
    enabled: () => !saving.value,
});

const confirmClear = async () => {
    const count = items.value.length;
    if (count === 0) return;
    if (await confirm(clearDraftsRequest(count))) clear();
};

const openAddDialog = () => {
    scanned.value = undefined;
    editItem.value = undefined;
    editingId.value = null;
    isAddDialogOpen.value = true;
};

const handleNewItem = (newItem: AddForm) => {
    const totalCost = quantityAmount(
        newItem.unitCost,
        newItem.quantity,
        newItem.unit,
    );
    add({ ...newItem, totalCost });
    isAddDialogOpen.value = false;
};

const editDraft = (item: Row) => {
    scanned.value = undefined;
    editingId.value = item.draftId;
    editItem.value = { ...item };
    isAddDialogOpen.value = true;
};

const handleUpdateItem = (updatedProduct: AddForm) => {
    if (editingId.value) replace(editingId.value, updatedProduct);
    editingId.value = null;
    isAddDialogOpen.value = false;
};

const deleteDraft = (item: Row) => {
    remove(item.draftId);
};
</script>
