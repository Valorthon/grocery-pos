<template>
    <PageCard title="Categories">
        <template #actions
            ><BaseButton @click="begin()">Add category</BaseButton></template
        >
        <div class="p-5">
            <p v-if="error" role="alert" class="text-red-700">
                {{ error }} <BaseButton @click="refresh">Retry</BaseButton>
            </p>
            <p v-if="loading">Loading categories…</p>
            <table class="w-full text-sm">
                <thead>
                    <tr>
                        <th class="text-left">Name</th>
                        <th>Order</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="row in categories"
                        :key="row._id"
                        class="border-t"
                    >
                        <td>{{ row.name }}</td>
                        <td class="text-center">{{ row.sortOrder }}</td>
                        <td>{{ row.isActive ? 'Active' : 'Archived' }}</td>
                        <td class="flex gap-2 py-2">
                            <BaseButton
                                size="sm"
                                :disabled="saving"
                                @click="begin(row)"
                                >Edit</BaseButton
                            ><BaseButton
                                size="sm"
                                variant="outline"
                                :disabled="saving"
                                @click="toggle(row)"
                                >{{
                                    row.isActive ? 'Archive' : 'Restore'
                                }}</BaseButton
                            ><BaseButton
                                size="sm"
                                variant="outline"
                                :disabled="saving"
                                @click="remove(row)"
                                >Delete</BaseButton
                            >
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
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
            <p v-if="saveError" role="alert" class="text-red-700">
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
    </PageCard>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import {
    CATEGORY_NAME_MAX,
    CATEGORY_SORT_MAX,
    type CategoryDto,
    type CreateCategoryRequest,
} from '@grocery-pos/contracts';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import { useCategories } from '@/composables/useCategories';
import { useConfirm } from '@/composables/useConfirm';
import { useUIStore, Color } from '@/stores/ui';
import { apiErrorText } from '@/utils/api-error';
const { categories, loading, error, refresh } = useCategories();
const { request, confirm, answer } = useConfirm();
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
        else await api.post('/categories', body);
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
</script>
