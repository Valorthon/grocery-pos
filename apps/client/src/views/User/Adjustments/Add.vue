<template>
    <PageCard title="Adjustment Draft">
        <template #icon>
            <ClipboardEdit class="w-5 h-5 text-primary-600" />
        </template>
        <template #actions>
            <BaseButton size="sm" @click="openAddDialog">
                <Plus class="w-4 h-4" />
                Adjust Stock
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
                label="Search adjusted products..."
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
            No new products added yet. Click "Adjust Stock" to start.
        </div>
        <div v-else class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-sm">
                <thead>
                    <tr
                        class="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"
                    >
                        <th class="py-2.5 px-5">EAN</th>
                        <th class="py-2.5 px-5">Name</th>
                        <th class="py-2.5 px-5 text-right">Change</th>
                        <th class="py-2.5 px-5">Reason</th>
                        <th class="py-2.5 px-5 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    <tr v-for="item in filteredItems" :key="item.draftId">
                        <td class="py-3 px-5">{{ item.EAN }}</td>
                        <td class="py-3 px-5 font-medium">{{ item.name }}</td>
                        <td class="py-3 px-5 text-right">{{ item.change }}</td>
                        <td class="py-3 px-5 text-slate-500">
                            {{ item.reason }}
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

    <AdjustAddDialog
        v-model="isAddDialogOpen"
        :item="editItem"
        @add="handleNewItem"
        @update="handleUpdateItem"
    />

    <AdjustSaveDialog v-model="isSaveDialogOpen" :save="saveToDB" />

    <ConfirmDialog :request="confirmRequest" @answer="answerConfirm" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ClipboardEdit, Pencil, Plus, Save, Trash2 } from '@lucide/vue';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import AdjustAddDialog from '@/components/User/Adjustments/AddDialog.vue';
import AdjustSaveDialog from '@/components/User/Adjustments/SaveDialog.vue';
import { AddForm, SaveForm } from '@/components/User/Adjustments/dto';
import { Color, useUIStore } from '@/stores/ui';
import { apiErrorMessages } from '@/utils/api-error';
import { toAdjustmentBody } from '@/utils/payloads';
import { useConfirm } from '@/composables/useConfirm';
import {
    clearDraftsRequest,
    useDraftList,
    useUnsavedDraftsGuard,
    type WithDraftId,
} from '@/composables/useDrafts';

type Row = WithDraftId<AddForm>;

const NOTHING_TO_SAVE = 'No adjustments to save';

const isAddDialogOpen = ref(false);
const isSaveDialogOpen = ref(false);
const search = ref('');
const { items, add, replace, remove, clear } = useDraftList<AddForm>();
const editItem = ref<AddForm>();
const editingId = ref<string | null>(null);

const uiStore = useUIStore();
const router = useRouter();

const {
    request: confirmRequest,
    confirm,
    answer: answerConfirm,
} = useConfirm();
useUnsavedDraftsGuard(() => items.value.length, confirm);

const filteredItems = computed(() => {
    const q = search.value.trim().toLowerCase();
    if (!q) return items.value;
    return items.value.filter(
        (i) =>
            i.name?.toLowerCase().includes(q) ||
            i.EAN?.toLowerCase().includes(q),
    );
});

/** An empty adjustment is never sent: say so instead of asking for details. */
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
    try {
        await api.post(
            '/adjustments',
            toAdjustmentBody(items.value, saveForm.description),
        );
    } catch (error) {
        uiStore.queueMessage(
            Color.ERROR,
            apiErrorMessages(error, 'Error saving. Try again.'),
        );
        return false;
    }

    // Saved: nothing is left unsaved, so the leave guard lets this go.
    clear();
    uiStore.queueMessage(Color.SUCCESS, 'Adjustments saved.');
    router.push({ name: 'Adjustments' });
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
    add(newItem);
    isAddDialogOpen.value = false;
};

const editDraft = (item: Row) => {
    editingId.value = item.draftId;
    editItem.value = { ...item };
    isAddDialogOpen.value = true;
};

const handleUpdateItem = (updatedItem: AddForm) => {
    if (editingId.value) replace(editingId.value, updatedItem);
    editingId.value = null;
    isAddDialogOpen.value = false;
};

const deleteDraft = (item: Row) => {
    remove(item.draftId);
};
</script>
