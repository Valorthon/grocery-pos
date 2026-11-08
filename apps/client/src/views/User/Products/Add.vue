<template>
    <PageFrame>
        <template #actions>
            <BaseButton size="sm" :disabled="saving" @click="openAddDialog">
                <Plus class="w-4 h-4" />
                Add Product
            </BaseButton>
            <BaseButton
                size="sm"
                variant="outline"
                :loading="saving"
                @click="saveToDB"
            >
                <Save class="w-4 h-4" />
                Save All
            </BaseButton>
        </template>
        <PageCard>
            <div
                class="px-5 py-4 bg-paper border-b border-line grid grid-cols-1 md:grid-cols-4 gap-3"
            >
                <BaseInput
                    v-model="search"
                    label="Search drafted products..."
                    clearable
                    class="md:col-span-3"
                />
                <div class="flex items-end">
                    <BaseButton
                        variant="outline"
                        size="sm"
                        block
                        :disabled="saving || items.length === 0"
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
                    items.length
                        ? 'No matching drafts'
                        : 'No product drafts yet'
                "
                :hint="
                    items.length
                        ? 'No draft matches the search.'
                        : 'No new products added yet. Click &quot;Add Product&quot; to start.'
                "
            >
                <template #icon><PackagePlus class="w-6 h-6" /></template>
            </EmptyState>
            <div v-else :class="draftTable.wrap">
                <table :class="draftTable.table">
                    <thead>
                        <tr :class="draftTable.headRow">
                            <th scope="col" :class="draftTable.th">EAN</th>
                            <th scope="col" :class="draftTable.th">Name</th>
                            <th scope="col" :class="draftTable.thNum">Price</th>
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
                            <td :class="[draftTable.td, 'num']">
                                <span
                                    v-if="item.autoGenerateEAN"
                                    class="text-muted italic"
                                    >[Auto-Generated]</span
                                >
                                <span v-else>{{ item.EAN }}</span>
                            </td>
                            <td :class="draftTable.tdName">{{ item.name }}</td>
                            <td :class="draftTable.tdNum">
                                {{ formatCurrency(item.price ?? 0) }}/{{
                                    unitLabel(item.unit)
                                }}
                            </td>
                            <td :class="draftTable.tdActions">
                                <DraftRowActions
                                    :edit-label="`Edit draft ${item.name}`"
                                    :delete-label="`Delete draft ${item.name}`"
                                    :disabled="saving"
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

    <AddProductDialog
        v-model="isAddDialogOpen"
        :item="editItem"
        @add="handleNewProduct"
        @update="updateDraft"
    />

    <ConfirmDialog :request="confirmRequest" @answer="answerConfirm" />
</template>

<script setup lang="ts">
import { unitLabel } from '@grocery-pos/contracts';
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
import AddProductDialog from '@/components/User/Product/AddDialog.vue';
import { Color, useUIStore } from '@/stores/ui';
import { formatCurrency } from '@/utils/currency';
import { apiErrorMessages } from '@/utils/api-error';
import { toNewProductsBody, type ProductDraft } from '@/utils/payloads';
import { useConfirm } from '@/composables/useConfirm';
import {
    clearDraftsRequest,
    useDraftList,
    useUnsavedDraftsGuard,
    type WithDraftId,
} from '@/composables/useDrafts';

type Row = WithDraftId<ProductDraft>;

const isAddDialogOpen = ref(false);
const uiStore = useUIStore();
const search = ref('');
const { items, add, replace, remove, clear } = useDraftList<ProductDraft>();
const editItem = ref<Partial<ProductDraft>>({});
const editingId = ref<string | null>(null);
const saving = ref(false);
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

const filteredItems = computed(() => {
    const q = search.value.trim().toLowerCase();
    if (!q) return items.value;
    return items.value.filter(
        (i) =>
            i.name?.toLowerCase().includes(q) ||
            i.EAN?.toLowerCase().includes(q),
    );
});

const saveToDB = async () => {
    // The button is busy while a save is in flight; this also stops a
    // second call that slips in before it re-renders.
    if (saving.value) return;
    if (items.value.length === 0) {
        uiStore.queueMessage(Color.ERROR, 'No products to save');
        return;
    }

    saving.value = true;
    try {
        await api.post('/products/bulk', toNewProductsBody(items.value));
    } catch (err: unknown) {
        if (unmounted) return;
        uiStore.queueMessage(
            Color.ERROR,
            apiErrorMessages(err, 'Error saving products. Please try again'),
        );
        return;
    } finally {
        saving.value = false;
    }

    if (unmounted) return;
    // Saved: nothing is left unsaved, so the leave guard lets this go.
    clear();
    void router.push({ name: 'Products' });
    uiStore.queueMessage(Color.SUCCESS, 'Products saved');
};

const confirmClear = async () => {
    const count = items.value.length;
    if (count === 0) return;
    if (await confirm(clearDraftsRequest(count))) clear();
};

const openAddDialog = () => {
    editItem.value = {};
    editingId.value = null;
    isAddDialogOpen.value = true;
};

const handleNewProduct = (newProduct: ProductDraft) => {
    add(newProduct);
    isAddDialogOpen.value = false;
    uiStore.queueMessage(Color.SUCCESS, 'Product added');
};

const editDraft = (item: Row) => {
    editingId.value = item.draftId;
    editItem.value = { ...item };
    isAddDialogOpen.value = true;
};

const updateDraft = (updatedProduct: ProductDraft) => {
    if (editingId.value) replace(editingId.value, updatedProduct);
    editingId.value = null;
    isAddDialogOpen.value = false;
};

const deleteDraft = (item: Row) => {
    remove(item.draftId);
};
</script>
