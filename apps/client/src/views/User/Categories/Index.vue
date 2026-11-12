<template>
    <PageFrame>
        <template #actions
            ><BaseButton @click="begin()">Add category</BaseButton></template
        >
        <BaseTable
            :headers="headers"
            :items="rows"
            :loading="loading && !rows.length"
            :error="error"
            row-click
            row-hint="Press Enter to edit the category"
            @click:row="begin"
            @retry="refresh"
        >
            <template #cell-status="{ item }">
                <Badge :color="item.isActive ? 'success' : 'neutral'">{{
                    item.isActive ? 'Active' : 'Archived'
                }}</Badge>
            </template>
            <template #cell-actions="{ item }">
                <RowActions :label="item.name" :actions="rowActions(item)" />
            </template>
            <template #empty>
                <EmptyState
                    title="No categories yet"
                    hint="Add a category to group products."
                >
                    <template #icon><Tags :size="24" /></template>
                </EmptyState>
            </template>
        </BaseTable>
        <BaseModal
            v-model="open"
            :title="editing ? 'Edit category' : 'Add category'"
            :closable="!saving"
        >
            <BaseInput
                v-model="name"
                label="Category name"
                :maxlength="CATEGORY_NAME_MAX"
            />
            <BaseInput
                v-model="sortOrder"
                label="Sort order"
                type="number"
                :min="0"
                :max="CATEGORY_SORT_MAX"
                :step="1"
            />
            <p v-if="saveError" role="alert" class="text-danger-fg">
                {{ saveError }}
            </p>
            <template #footer
                ><BaseButton
                    variant="outline"
                    :disabled="saving"
                    @click="open = false"
                    >Cancel</BaseButton
                ><BaseButton :disabled="saving" @click="save">{{
                    saving ? 'Saving…' : 'Save'
                }}</BaseButton></template
            >
        </BaseModal>
        <ConfirmDialog :request="request" @answer="answer" />
    </PageFrame>
</template>
<script setup lang="ts">
import { CATEGORY_HELP } from '../list-help';
import { computed, ref } from 'vue';
import {
    CATEGORY_NAME_MAX,
    CATEGORY_SORT_MAX,
    type CategoryDto,
    type CreateCategoryRequest,
} from '@grocery-pos/contracts';
import api from '@/axios';
import PageFrame from '@/components/ui/PageFrame.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import Badge from '@/components/ui/Badge.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import type { TableHeader } from '@/components/ui/types';
import { Tags } from '@lucide/vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import RowActions from '@/components/ui/RowActions.vue';
import type { RowAction } from '@/components/ui/row-actions';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import { useCategories } from '@/composables/useCategories';
import { useConfirm } from '@/composables/useConfirm';
import { useUIStore, Color } from '@/stores/ui';
import { apiErrorText } from '@/utils/api-error';
const { categories, loading, error, refresh } = useCategories();
const { request, confirm, answer } = useConfirm();
const headers: TableHeader[] = [
    { key: 'name', title: 'Name' },
    {
        key: 'sortOrder',
        title: 'Order',
        align: 'right',
        help: CATEGORY_HELP.sortOrder,
    },
    { key: 'status', title: 'Status', help: CATEGORY_HELP.status },
    { key: 'actions', title: 'Actions', align: 'right' },
];
const rows = computed(() =>
    categories.value.map((row) => ({ ...row, id: row._id })),
);
const open = ref(false),
    saving = ref(false),
    name = ref(''),
    sortOrder = ref<string | number>('0'),
    saveError = ref('');
const editing = ref<CategoryDto | null>(null);
function begin(row?: CategoryDto) {
    editing.value = row ?? null;
    name.value = row?.name ?? '';
    sortOrder.value = row?.sortOrder ?? 0;
    saveError.value = '';
    open.value = true;
}
async function save() {
    if (saving.value) return;
    const order = Number(sortOrder.value);
    if (
        !name.value.trim() ||
        name.value.trim().length > CATEGORY_NAME_MAX ||
        String(sortOrder.value).trim() === '' ||
        !Number.isInteger(order) ||
        order < 0 ||
        order > CATEGORY_SORT_MAX
    ) {
        saveError.value = 'Enter a name and valid whole-number sort order.';
        return;
    }
    saving.value = true;
    saveError.value = '';
    try {
        const body = {
            name: name.value.trim(),
            sortOrder: order,
        } satisfies CreateCategoryRequest;
        if (editing.value)
            await api.patch(`/categories/${editing.value._id}`, body);
        else {
            await api.post('/categories', body);
            useUIStore().queueMessage(Color.SUCCESS, 'Category created');
        }
        open.value = false;
        await refresh();
    } catch (cause) {
        saveError.value = apiErrorText(cause);
    } finally {
        saving.value = false;
    }
}
async function toggle(row: CategoryDto) {
    if (
        saving.value ||
        !(await confirm({
            title: row.isActive ? 'Archive category?' : 'Restore category?',
            message: row.isActive
                ? `Archive ${row.name}? Existing products remain unchanged; new assignments will be blocked.`
                : `Restore ${row.name} for assignment?`,
            confirmLabel: row.isActive ? 'Archive' : 'Restore',
        }))
    )
        return;
    saving.value = true;
    try {
        await api.patch(`/categories/${row._id}`, { isActive: !row.isActive });
        await refresh();
    } catch (cause) {
        useUIStore().queueMessage(Color.ERROR, apiErrorText(cause));
    } finally {
        saving.value = false;
    }
}
async function remove(row: CategoryDto) {
    if (
        saving.value ||
        !(await confirm({
            title: 'Delete category?',
            message: `Delete ${row.name}? Categories referenced by any product must be archived instead.`,
            confirmLabel: 'Delete',
            danger: true,
        }))
    )
        return;
    saving.value = true;
    try {
        await api.delete(`/categories/${row._id}`);
        await refresh();
    } catch (cause) {
        useUIStore().queueMessage(Color.ERROR, apiErrorText(cause));
    } finally {
        saving.value = false;
    }
}
/** Edit, Archive/Restore and Delete in one menu (#311). */
function rowActions(row: CategoryDto): RowAction[] {
    return [
        { label: 'Edit', disabled: saving.value, onSelect: () => begin(row) },
        {
            label: row.isActive ? 'Archive' : 'Restore',
            disabled: saving.value,
            danger: row.isActive,
            onSelect: () => void toggle(row),
        },
        {
            label: 'Delete',
            disabled: saving.value,
            danger: true,
            onSelect: () => void remove(row),
        },
    ];
}
</script>
