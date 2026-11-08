<template>
    <PageFrame>
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
        <PageCard>
            <div
                class="px-5 py-4 bg-paper border-b border-line grid grid-cols-1 md:grid-cols-4 gap-3"
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

            <EmptyState
                v-if="filteredItems.length === 0"
                :title="
                    items.length
                        ? 'No matching drafts'
                        : 'No adjustment lines yet'
                "
                :hint="
                    items.length
                        ? 'No draft matches the search.'
                        : 'No adjustments added yet. Click &quot;Adjust Stock&quot; to start.'
                "
            >
                <template #icon><SlidersHorizontal class="w-6 h-6" /></template>
            </EmptyState>
            <div v-else :class="draftTable.wrap">
                <table :class="draftTable.table">
                    <thead>
                        <tr :class="draftTable.headRow">
                            <th scope="col" :class="draftTable.th">EAN</th>
                            <th scope="col" :class="draftTable.th">Name</th>
                            <th scope="col" :class="draftTable.thNum">
                                Change
                            </th>
                            <th scope="col" :class="draftTable.th">Reason</th>
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
                                {{ item.EAN }}
                            </td>
                            <td :class="draftTable.tdName">
                                {{ item.name }}
                            </td>
                            <td :class="draftTable.tdNum">
                                {{ formatQuantity(item.change, item.unit) }}
                            </td>
                            <td :class="draftTable.tdMuted">
                                {{ item.reason }}
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
import { useAdjustmentPrefillStore } from '@/stores/adjustmentPrefill';
import { formatQuantity } from '@grocery-pos/contracts';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Plus, Save, SlidersHorizontal, Trash2 } from '@lucide/vue';
import DraftRowActions from '@/components/ui/DraftRowActions.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import { draftTable } from '@/components/ui/draft-table';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import PageFrame from '@/components/ui/PageFrame.vue';
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
const pendingWriteOff = useAdjustmentPrefillStore().take();
if (pendingWriteOff) add(pendingWriteOff);
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
    saving.value = true;
    try {
        await api.post(
            '/adjustments',
            toAdjustmentBody(items.value, saveForm.description),
        );
    } catch (error) {
        if (unmounted) return false;
        uiStore.queueMessage(
            Color.ERROR,
            apiErrorMessages(error, 'Error saving. Try again.'),
        );
        return false;
    } finally {
        saving.value = false;
    }

    if (unmounted) return true;
    // Saved: nothing is left unsaved, so the leave guard lets this go.
    clear();
    uiStore.queueMessage(Color.SUCCESS, 'Adjustments saved.');
    void router.push({ name: 'Adjustments' });
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
