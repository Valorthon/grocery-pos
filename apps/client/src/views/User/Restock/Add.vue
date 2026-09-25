<template>
    <PageCard title="Restock Draft">
        <template #icon>
            <Truck class="w-5 h-5 text-primary-600" />
        </template>
        <template #actions>
            <BaseButton size="sm" @click="openAddDialog">
                <Plus class="w-4 h-4" />
                Add Product
            </BaseButton>
            <BaseButton size="sm" variant="outline" @click="openSaveDialog">
                <Save class="w-4 h-4" />
                Save
            </BaseButton>
        </template>

        <div
            class="px-5 py-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 md:grid-cols-4 gap-3"
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

        <div
            v-if="filteredItems.length === 0"
            class="py-16 text-center text-slate-400 text-sm"
        >
            No new products added yet. Click "Add Product" to start.
        </div>
        <div v-else class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-sm">
                <thead>
                    <tr
                        class="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"
                    >
                        <th class="py-2.5 px-5">Name</th>
                        <th class="py-2.5 px-5 text-right">Quantity</th>
                        <th class="py-2.5 px-5 text-right">Unit Cost</th>
                        <th class="py-2.5 px-5 text-right">Total Cost</th>
                        <th class="py-2.5 px-5 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    <tr v-for="item in filteredItems" :key="item.draftId">
                        <td class="py-3 px-5 font-medium">{{ item.name }}</td>
                        <td class="py-3 px-5 text-right">
                            {{ item.quantity }}
                        </td>
                        <td class="py-3 px-5 text-right">
                            {{ formatCurrency(item.unitCost ?? 0) }}
                        </td>
                        <td class="py-3 px-5 text-right font-bold">
                            {{
                                formatCurrency(
                                    (item.unitCost ?? 0) * (item.quantity ?? 0),
                                )
                            }}
                        </td>
                        <td class="py-3 px-5">
                            <div class="flex justify-end gap-1">
                                <button
                                    type="button"
                                    class="p-1.5 rounded-lg text-slate-500 hover:text-primary-600 hover:bg-primary-50"
                                    aria-label="Edit draft"
                                    @click="editDraft(item)"
                                >
                                    <Pencil class="w-4 h-4" />
                                </button>
                                <button
                                    type="button"
                                    class="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50"
                                    aria-label="Delete draft"
                                    @click="deleteDraft(item)"
                                >
                                    <Trash2 class="w-4 h-4" />
                                </button>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </PageCard>

    <RestockAddDialog
        v-model="isAddDialogOpen"
        :item="editItem"
        @add="handleNewItem"
        @update="handleUpdateItem"
    />

    <RestockSaveDialog v-model="isSaveDialogOpen" :save="saveToDB" />

    <ConfirmDialog :request="confirmRequest" @answer="answerConfirm" />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Pencil, Plus, Save, Trash2, Truck } from '@lucide/vue';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import RestockAddDialog from '@/components/User/Restock/AddDialog.vue';
import RestockSaveDialog from '@/components/User/Restock/SaveDialog.vue';
import { AddForm, SaveForm } from '@/components/User/Restock/dto';
import { Color, useUIStore } from '@/stores/ui';
import { formatCurrency } from '@/utils/currency';
import { apiErrorMessages } from '@/utils/api-error';
import { newProductLines, toRestockBody } from '@/utils/payloads';
import { useConfirm } from '@/composables/useConfirm';
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

/** An empty restock is never sent: say so instead of asking for details. */
const openSaveDialog = () => {
    if (items.value.length === 0) {
        uiStore.queueMessage(Color.ERROR, NOTHING_TO_SAVE);
        return;
    }
    isSaveDialogOpen.value = true;
};

/** The save dialog waits on this and closes only when it is true. */
const saveToDB = async (saveForm: SaveForm): Promise<boolean> => {
    if (items.value.length === 0) {
        uiStore.queueMessage(Color.ERROR, NOTHING_TO_SAVE);
        return false;
    }
    // The API numbers insert errors among the new products only.
    const newLines = newProductLines(items.value);
    saving.value = true;
    try {
        await api.post(
            '/restocks',
            toRestockBody(items.value, saveForm.description),
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
    router.push({ name: 'Restocks' });
    return true;
};

const confirmClear = async () => {
    const count = items.value.length;
    if (count === 0) return;
    if (await confirm(clearDraftsRequest(count))) clear();
};

const openAddDialog = () => {
    editItem.value = undefined;
    editingId.value = null;
    isAddDialogOpen.value = true;
};

const handleNewItem = (newItem: AddForm) => {
    const totalCost = newItem.quantity * newItem.unitCost;
    add({ ...newItem, totalCost });
    isAddDialogOpen.value = false;
};

const editDraft = (item: Row) => {
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
