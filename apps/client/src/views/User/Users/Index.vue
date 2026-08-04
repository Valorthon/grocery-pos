<template>
    <v-card elevation="2" class="rounded-lg border">
        <v-card-title class="d-flex align-center px-4 py-3 bg-grey-lighten-4">
            <v-icon
                icon="mdi-account-multiple-outline"
                color="amber-darken-2"
                class="me-2"
            />
            <span class="text-subtitle-1 font-weight-bold">Users</span>
            <v-spacer />
            <div class="d-flex ga-2">
                <v-btn
                    color="amber-darken-2"
                    variant="flat"
                    prepend-icon="mdi-plus"
                    size="small"
                    @click="isCreateOpen = true"
                >
                    Add User
                </v-btn>
            </div>
        </v-card-title>

        <v-divider />

        <v-card-text class="bg-grey-lighten-5 pt-4">
            <v-row align="center">
                <v-col cols="12" md="4">
                    <v-text-field
                        v-model="searchName"
                        label="Search Name"
                        prepend-inner-icon="mdi-magnify"
                        variant="outlined"
                        density="compact"
                        bg-color="white"
                        hide-details
                        color="amber-darken-2"
                        clearable
                        @update:model-value="resetSearch"
                    />
                </v-col>
                <v-spacer />
                <v-col cols="12" md="2">
                    <v-btn
                        color="grey-darken-2"
                        variant="tonal"
                        prepend-icon="mdi-filter-remove-outline"
                        block
                        @click="resetFilters"
                    >
                        Clear Filters
                    </v-btn>
                </v-col>
            </v-row>
        </v-card-text>

        <v-divider />

        <v-data-table-server
            v-model:items-per-page="limit"
            v-model:page="page"
            :headers="headers"
            :items="serverItems"
            :items-length="totalItems"
            :loading="loading"
            hover
            @update:options="fetchUsers"
        >
            <template #loading>
                <v-skeleton-loader type="table-row@5" />
            </template>

            <template #[`item.roles`]="{ item }">
                <v-chip
                    v-for="role in item.roles"
                    :key="role"
                    size="x-small"
                    variant="tonal"
                    class="me-1"
                >
                    {{ role }}
                </v-chip>
            </template>

            <template #[`item.isActive`]="{ item }">
                <v-chip
                    :color="item.isActive ? 'success' : 'error'"
                    size="x-small"
                    variant="tonal"
                >
                    {{ item.isActive ? 'Active' : 'Inactive' }}
                </v-chip>
            </template>

            <template #[`item.actions`]="{ item }">
                <v-btn
                    icon="mdi-pencil"
                    variant="text"
                    color="blue-darken-2"
                    size="small"
                    density="comfortable"
                    @click="openEdit(item)"
                />
            </template>
        </v-data-table-server>
    </v-card>

    <!-- Create Dialog -->
    <v-dialog v-model="isCreateOpen" max-width="520" destroy-on-close>
        <v-card rounded="xl" elevation="0" border>
            <v-card-title class="pa-5 text-subtitle-1 font-weight-bold">
                Add User
            </v-card-title>
            <v-divider />
            <v-card-text class="pa-5">
                <v-text-field
                    v-model="createForm.name"
                    label="Username"
                    variant="outlined"
                    density="compact"
                    color="amber-darken-2"
                    class="mb-3"
                />
                <v-text-field
                    v-model="createForm.password"
                    label="Password"
                    type="password"
                    variant="outlined"
                    density="compact"
                    color="amber-darken-2"
                    class="mb-3"
                />
                <v-select
                    v-model="createForm.roles"
                    :items="roleOptions"
                    label="Roles"
                    multiple
                    chips
                    variant="outlined"
                    density="compact"
                    color="amber-darken-2"
                />
            </v-card-text>
            <v-divider />
            <v-card-actions class="pa-5">
                <v-spacer />
                <v-btn variant="tonal" @click="isCreateOpen = false">
                    Cancel
                </v-btn>
                <v-btn
                    color="green-darken-2"
                    variant="flat"
                    :loading="saving"
                    @click="createUser"
                >
                    Save
                </v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>

    <!-- Edit Dialog -->
    <v-dialog v-model="isEditOpen" max-width="520" destroy-on-close>
        <v-card rounded="xl" elevation="0" border>
            <v-card-title class="pa-5 text-subtitle-1 font-weight-bold">
                Edit User
            </v-card-title>
            <v-divider />
            <v-card-text class="pa-5">
                <v-text-field
                    v-model="editForm.name"
                    label="Username"
                    variant="outlined"
                    density="compact"
                    color="amber-darken-2"
                    class="mb-3"
                    disabled
                />
                <v-text-field
                    v-model="editForm.password"
                    label="New Password (optional)"
                    type="password"
                    variant="outlined"
                    density="compact"
                    color="amber-darken-2"
                    class="mb-3"
                />
                <v-select
                    v-model="editForm.roles"
                    :items="roleOptions"
                    label="Roles"
                    multiple
                    chips
                    variant="outlined"
                    density="compact"
                    color="amber-darken-2"
                    class="mb-3"
                />
                <v-switch
                    v-model="editForm.isActive"
                    label="Active"
                    color="success"
                    density="compact"
                    hide-details
                />
            </v-card-text>
            <v-divider />
            <v-card-actions class="pa-5">
                <v-spacer />
                <v-btn variant="tonal" @click="isEditOpen = false">
                    Cancel
                </v-btn>
                <v-btn
                    color="green-darken-2"
                    variant="flat"
                    :loading="saving"
                    @click="updateUser"
                >
                    Save
                </v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script setup lang="ts">
import api from '@/axios';
import { Color, useUIStore } from '@/stores/ui';
import { Role } from '@/stores/auth';
import { isAxiosError } from 'axios';
import { ref } from 'vue';

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

const headers = ref([
    { title: 'Name', key: 'name', align: 'start' as const, sortable: false },
    { title: 'Roles', key: 'roles', align: 'start' as const, sortable: false },
    {
        title: 'Status',
        key: 'isActive',
        align: 'start' as const,
        sortable: false,
    },
    {
        title: 'Actions',
        key: 'actions',
        align: 'end' as const,
        sortable: false,
    },
]);

const isCreateOpen = ref(false);
const createForm = ref({
    name: '',
    password: '',
    roles: [] as Role[],
});

const isEditOpen = ref(false);
const editForm = ref({
    _id: '',
    name: '',
    password: '',
    roles: [] as Role[],
    isActive: true,
});

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
            updates: [
                {
                    user: editForm.value._id,
                    update,
                },
            ],
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
