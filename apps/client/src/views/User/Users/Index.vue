<template>
    <PageCard title="Users">
        <template #icon>
            <Users class="w-5 h-5 text-primary-600" />
        </template>
        <template #actions>
            <BaseButton size="sm" @click="isCreateOpen = true">
                <Plus class="w-4 h-4" />
                Add User
            </BaseButton>
        </template>

        <div
            class="px-5 py-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 md:grid-cols-4 gap-3"
        >
            <BaseInput
                v-model="searchName"
                label="Search Name"
                clearable
                @enter="resetSearch"
                @clear="resetSearch"
            />
            <div class="md:col-span-3 flex items-end">
                <BaseButton variant="outline" size="sm" @click="resetFilters">
                    <X class="w-4 h-4" />
                    Clear Filters
                </BaseButton>
            </div>
        </div>

        <BaseTable
            v-model:page="page"
            v-model:items-per-page="limit"
            :headers="headers"
            :items="serverItems"
            :loading="loading"
            empty-text="No users found"
            :items-length="totalItems"
        >
            <template #cell-roles="{ value }">
                <div class="flex flex-wrap gap-1">
                    <Badge v-for="role in value" :key="role" color="primary">{{
                        role
                    }}</Badge>
                </div>
            </template>
            <template #cell-isActive="{ value }">
                <Badge :color="value ? 'success' : 'error'">{{
                    value ? 'Active' : 'Inactive'
                }}</Badge>
            </template>
            <template #cell-actions="{ item }">
                <div class="flex justify-end">
                    <button
                        type="button"
                        class="p-1.5 rounded-lg text-slate-500 hover:text-primary-600 hover:bg-primary-50"
                        @click="openEdit(item)"
                    >
                        <Pencil class="w-4 h-4" />
                    </button>
                </div>
            </template>
        </BaseTable>
    </PageCard>

    <BaseModal v-model="isCreateOpen" title="Add User" max-width="28rem">
        <div class="space-y-4">
            <BaseInput v-model="createForm.name" label="Username" />
            <BaseInput
                v-model="createForm.password"
                label="Password"
                type="password"
            />
            <div>
                <label
                    class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2"
                    >Roles</label
                >
                <div class="space-y-1.5">
                    <BaseCheckbox
                        v-for="role in roleOptions"
                        :key="role"
                        :model-value="createForm.roles.includes(role)"
                        :label="role"
                        @update:model-value="
                            toggleRole(createForm.roles, role, $event)
                        "
                    />
                </div>
            </div>
        </div>
        <template #footer>
            <BaseButton variant="outline" @click="isCreateOpen = false"
                >Cancel</BaseButton
            >
            <BaseButton class="flex-1" :loading="saving" @click="createUser"
                >Save</BaseButton
            >
        </template>
    </BaseModal>

    <BaseModal v-model="isEditOpen" title="Edit User" max-width="28rem">
        <div class="space-y-4">
            <BaseInput v-model="editForm.name" label="Username" disabled />
            <BaseInput
                v-model="editForm.password"
                label="New Password (optional)"
                type="password"
            />
            <div>
                <label
                    class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2"
                    >Roles</label
                >
                <div class="space-y-1.5">
                    <BaseCheckbox
                        v-for="role in roleOptions"
                        :key="role"
                        :model-value="editForm.roles.includes(role)"
                        :label="role"
                        @update:model-value="
                            toggleRole(editForm.roles, role, $event)
                        "
                    />
                </div>
            </div>
            <BaseCheckbox v-model="editForm.isActive" label="Active" />
        </div>
        <template #footer>
            <BaseButton variant="outline" @click="isEditOpen = false"
                >Cancel</BaseButton
            >
            <BaseButton class="flex-1" :loading="saving" @click="updateUser"
                >Save</BaseButton
            >
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { Pencil, Plus, Users, X } from '@lucide/vue';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseCheckbox from '@/components/ui/BaseCheckbox.vue';
import Badge from '@/components/ui/Badge.vue';
import { Color, useUIStore } from '@/stores/ui';
import { Role } from '@/stores/auth';
import { isAxiosError } from 'axios';

const loading = ref(true);
const limit = ref(5);
const page = ref(1);
const totalItems = ref(0);
const searchName = ref('');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const serverItems = ref<any[]>([]);

const uiStore = useUIStore();
const saving = ref(false);

const roleOptions = Object.values(Role).filter(
    (r) => r !== Role.Unauthenticated,
);

const headers = [
    { key: 'name', title: 'Name' },
    { key: 'roles', title: 'Roles' },
    { key: 'isActive', title: 'Status' },
    { key: 'actions', title: 'Actions', align: 'right' as const },
];

const isCreateOpen = ref(false);
const createForm = ref({ name: '', password: '', roles: [] as Role[] });

const isEditOpen = ref(false);
const editForm = ref({
    _id: '',
    name: '',
    password: '',
    roles: [] as Role[],
    isActive: true,
});

function toggleRole(list: Role[], role: Role, checked: boolean) {
    if (checked) {
        if (!list.includes(role)) list.push(role);
    } else {
        const i = list.indexOf(role);
        if (i > -1) list.splice(i, 1);
    }
}

const resetSearch = () => {
    page.value = 1;
    fetchUsers();
};

const resetFilters = () => {
    searchName.value = '';
    resetSearch();
};

async function fetchUsers() {
    loading.value = true;
    const result = await api.get(`/users`, {
        params: {
            page: page.value,
            limit: limit.value,
            name: searchName.value?.toLowerCase(),
        },
    });

    serverItems.value = result.data.data;
    totalItems.value = result.data.totalItems;
    loading.value = false;
}

fetchUsers();
watch([page, limit], fetchUsers);

async function createUser() {
    saving.value = true;
    try {
        await api.post('/users', {
            users: [
                {
                    name: createForm.value.name,
                    password: createForm.value.password,
                    roles: createForm.value.roles,
                },
            ],
        });
        uiStore.queueMessage(Color.SUCCESS, 'User created');
        isCreateOpen.value = false;
        createForm.value = { name: '', password: '', roles: [] };
        fetchUsers();
    } catch (error) {
        if (isAxiosError(error)) {
            uiStore.queueMessage(
                Color.ERROR,
                error.response?.data?.message ?? 'Create failed',
            );
        }
    } finally {
        saving.value = false;
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function openEdit(item: any) {
    editForm.value = {
        _id: item._id,
        name: item.name,
        password: '',
        roles: item.roles ?? [],
        isActive: item.isActive ?? true,
    };
    isEditOpen.value = true;
}

async function updateUser() {
    saving.value = true;
    try {
        const update: Record<string, unknown> = {
            roles: editForm.value.roles,
            isActive: editForm.value.isActive,
        };
        if (editForm.value.password) {
            update.password = editForm.value.password;
        }

        await api.patch('/users', {
            updates: [{ user: editForm.value._id, update }],
        });
        uiStore.queueMessage(Color.SUCCESS, 'User updated');
        isEditOpen.value = false;
        fetchUsers();
    } catch (error) {
        if (isAxiosError(error)) {
            uiStore.queueMessage(
                Color.ERROR,
                error.response?.data?.message ?? 'Update failed',
            );
        }
    } finally {
        saving.value = false;
    }
}
</script>
