<template>
    <PageFrame>
        <template #actions
            ><BaseButton @click="begin()">Add supplier</BaseButton></template
        >
        <BaseTable
            :headers="headers"
            :items="rows"
            :loading="loading && !rows.length"
            :error="error"
            row-click
            :row-clickable="() => !saving"
            row-hint="Press Enter to edit the supplier"
            @click:row="begin"
            @retry="refresh"
        >
            <template #cell-contactPerson="{ item }">{{
                item.contactPerson || '—'
            }}</template>
            <template #cell-phone="{ item }">{{ item.phone || '—' }}</template>
            <template #cell-email="{ item }">{{ item.email || '—' }}</template>
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
                    title="No suppliers yet"
                    hint="Add a supplier to record restocks against it."
                >
                    <template #icon><Truck :size="24" /></template>
                </EmptyState>
            </template>
        </BaseTable>
        <BaseModal
            v-model="open"
            :title="editing ? 'Edit supplier' : 'Add supplier'"
            :closable="!saving"
        >
            <div class="space-y-3">
                <BaseInput
                    v-model="form.name"
                    label="Supplier name"
                    :maxlength="SUPPLIER_LIMITS.NAME"
                />
                <BaseInput
                    v-model="form.contactPerson"
                    label="Contact person"
                    :maxlength="SUPPLIER_LIMITS.CONTACT"
                />
                <BaseInput
                    v-model="form.phone"
                    label="Phone"
                    :maxlength="SUPPLIER_LIMITS.PHONE"
                />
                <BaseInput
                    v-model="form.email"
                    label="Email"
                    :maxlength="SUPPLIER_LIMITS.EMAIL"
                />
                <BaseInput
                    v-model="form.address"
                    label="Address"
                    :maxlength="SUPPLIER_LIMITS.ADDRESS"
                />
                <BaseInput
                    v-model="form.TIN"
                    label="TIN"
                    :maxlength="SUPPLIER_LIMITS.TIN"
                />
                <p v-if="saveError" role="alert" class="text-sm text-danger-fg">
                    {{ saveError }}
                </p>
            </div>
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
import { SUPPLIER_HELP } from '../list-help';
import { computed, reactive, ref } from 'vue';
import {
    SUPPLIER_LIMITS,
    type SupplierView,
    type CreateSupplierRequest,
} from '@grocery-pos/contracts';
import api from '@/axios';
import PageFrame from '@/components/ui/PageFrame.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import Badge from '@/components/ui/Badge.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import type { TableHeader } from '@/components/ui/types';
import { Truck } from '@lucide/vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import RowActions from '@/components/ui/RowActions.vue';
import type { RowAction } from '@/components/ui/row-actions';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import { useSuppliers } from '@/composables/useSuppliers';
import { useConfirm } from '@/composables/useConfirm';
import { useUIStore, Color } from '@/stores/ui';
import { apiErrorText } from '@/utils/api-error';
const { suppliers, loading, error, refresh } = useSuppliers();
const { request, confirm, answer } = useConfirm();
const headers: TableHeader[] = [
    { key: 'name', title: 'Supplier', rowHeader: true },
    { key: 'contactPerson', title: 'Contact person' },
    { key: 'phone', title: 'Phone' },
    { key: 'email', title: 'Email' },
    { key: 'status', title: 'Status', help: SUPPLIER_HELP.status },
    { key: 'actions', title: 'Actions', align: 'right' },
];
const rows = computed(() =>
    suppliers.value.map((row) => ({ ...row, id: row._id })),
);
const open = ref(false),
    saving = ref(false),
    saveError = ref('');
const empty = () => ({
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    TIN: '',
});
const form = reactive(empty());
const editing = ref<SupplierView>();
function begin(row?: SupplierView) {
    editing.value = row;
    Object.assign(form, empty(), row);
    saveError.value = '';
    open.value = true;
}
async function save() {
    if (saving.value) return;
    if (!form.name.trim() || form.name.trim().length > SUPPLIER_LIMITS.NAME) {
        saveError.value = 'Enter a supplier name.';
        return;
    }
    saving.value = true;
    saveError.value = '';
    const body: CreateSupplierRequest = {
        name: form.name.trim(),
        contactPerson: form.contactPerson.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        TIN: form.TIN.trim(),
        email: form.email.trim(),
    };
    try {
        if (editing.value)
            await api.patch(`/suppliers/${editing.value._id}`, body);
        else await api.post('/suppliers', body);
        open.value = false;
        await refresh();
    } catch (cause) {
        saveError.value = apiErrorText(cause);
    } finally {
        saving.value = false;
    }
}
async function toggle(row: SupplierView) {
    if (
        saving.value ||
        !(await confirm({
            title: row.isActive ? 'Archive supplier?' : 'Restore supplier?',
            message: row.name,
            confirmLabel: row.isActive ? 'Archive' : 'Restore',
        }))
    )
        return;
    saving.value = true;
    try {
        await api.patch(`/suppliers/${row._id}`, { isActive: !row.isActive });
        await refresh();
    } catch (cause) {
        useUIStore().queueMessage(Color.ERROR, apiErrorText(cause));
    } finally {
        saving.value = false;
    }
}
async function remove(row: SupplierView) {
    if (
        saving.value ||
        !(await confirm({
            title: 'Delete unused supplier?',
            message: 'Suppliers with receipt history must be archived instead.',
            confirmLabel: 'Delete',
            danger: true,
        }))
    )
        return;
    saving.value = true;
    try {
        await api.delete(`/suppliers/${row._id}`);
        await refresh();
    } catch (cause) {
        useUIStore().queueMessage(Color.ERROR, apiErrorText(cause));
    } finally {
        saving.value = false;
    }
}
/** Edit, Archive/Restore and Delete, with their confirmations, as before. */
function rowActions(row: SupplierView): RowAction[] {
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
