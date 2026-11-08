<template>
    <PageFrame>
        <template #actions
            ><BaseButton @click="begin()">Add supplier</BaseButton></template
        >
        <PageCard>
            <div class="p-5">
                <p v-if="error" role="alert" class="text-red-700">
                    {{ error }} <BaseButton @click="refresh">Retry</BaseButton>
                </p>
                <p v-if="loading">Loading suppliers…</p>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead>
                            <tr>
                                <th class="text-left">Supplier</th>
                                <th>Contact</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="row in suppliers"
                                :key="row._id"
                                class="border-t"
                            >
                                <td>{{ row.name }}</td>
                                <td>
                                    {{ row.contactPerson }} {{ row.phone }}
                                    {{ row.email }}
                                </td>
                                <td>
                                    {{ row.isActive ? 'Active' : 'Archived' }}
                                </td>
                                <td class="flex gap-2 py-2">
                                    <BaseButton
                                        :disabled="saving"
                                        @click="begin(row)"
                                        >Edit</BaseButton
                                    ><BaseButton
                                        variant="outline"
                                        :disabled="saving"
                                        @click="toggle(row)"
                                        >{{
                                            row.isActive ? 'Archive' : 'Restore'
                                        }}</BaseButton
                                    ><BaseButton
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
            </div>
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
                    <p
                        v-if="saveError"
                        role="alert"
                        class="text-sm text-red-700"
                    >
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
        </PageCard>
    </PageFrame>
</template>
<script setup lang="ts">
import { reactive, ref } from 'vue';
import {
    SUPPLIER_LIMITS,
    type SupplierView,
    type CreateSupplierRequest,
} from '@grocery-pos/contracts';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import PageFrame from '@/components/ui/PageFrame.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import { useSuppliers } from '@/composables/useSuppliers';
import { useConfirm } from '@/composables/useConfirm';
import { useUIStore, Color } from '@/stores/ui';
import { apiErrorText } from '@/utils/api-error';
const { suppliers, loading, error, refresh } = useSuppliers();
const { request, confirm, answer } = useConfirm();
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
</script>
