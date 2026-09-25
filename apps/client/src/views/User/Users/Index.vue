<template>
    <PageCard title="Users">
        <template #icon>
            <Users class="w-5 h-5 text-primary-600" />
        </template>
        <template #actions>
            <BaseButton size="sm" @click="openCreate">
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
                :maxlength="STRING_LIMITS.USERNAME"
                clearable
                @enter="search"
                @clear="search"
            />
            <div class="md:col-span-3 flex items-end gap-2">
                <BaseButton size="sm" @click="search">
                    <Search class="w-4 h-4" />
                    Search
                </BaseButton>
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
            :error="loadError"
            empty-text="No users found"
            :items-length="totalItems"
            @retry="fetchUsers"
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
                        class="p-1.5 rounded-lg text-slate-500 hover:text-primary-600 hover:bg-primary-50 disabled:opacity-40 disabled:pointer-events-none"
                        :disabled="!canEdit(item)"
                        :title="
                            canEdit(item)
                                ? 'Edit'
                                : 'Only an admin can edit this user'
                        "
                        @click="openEdit(item)"
                    >
                        <Pencil class="w-4 h-4" />
                    </button>
                </div>
            </template>
        </BaseTable>
    </PageCard>

    <BaseModal
        v-model="createModel"
        title="Add User"
        max-width="28rem"
        :closable="!saving"
    >
        <div class="space-y-4">
            <BaseInput
                v-model="createForm.name"
                label="Username"
                :maxlength="STRING_LIMITS.USERNAME"
                :error="createErrors.name"
            />
            <BaseInput
                v-model="createForm.password"
                label="Password"
                type="password"
                :placeholder="PASSWORD_HINT"
                :error="
                    createErrors.password ||
                    (createForm.password ? createPasswordError : '')
                "
            />
            <div>
                <label
                    class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2"
                    >Roles</label
                >
                <div class="space-y-1.5">
                    <BaseCheckbox
                        v-for="role in grantableRoles"
                        :key="role"
                        :model-value="createForm.roles.includes(role)"
                        :label="role"
                        @update:model-value="
                            toggleRole(createForm.roles, role, $event)
                        "
                    />
                </div>
                <p
                    v-if="createErrors.roles"
                    data-testid="create-roles-error"
                    class="text-xs text-red-600 mt-1"
                >
                    {{ createErrors.roles }}
                </p>
            </div>
        </div>
        <template #footer>
            <BaseButton
                variant="outline"
                :disabled="saving"
                @click="createModel = false"
                >Cancel</BaseButton
            >
            <BaseButton class="flex-1" :loading="saving" @click="createUser"
                >Save</BaseButton
            >
        </template>
    </BaseModal>

    <BaseModal
        v-model="editModel"
        title="Edit User"
        max-width="28rem"
        :closable="!saving"
    >
        <div class="space-y-4">
            <BaseInput v-model="editForm.name" label="Username" disabled />
            <BaseInput
                v-if="canResetPassword"
                v-model="editForm.password"
                label="New Password (optional)"
                type="password"
                :placeholder="`${PASSWORD_HINT}, or blank to keep it`"
                :error="editPasswordError"
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
                        :disabled="
                            isEditingSelf || !grantableRoles.includes(role)
                        "
                        @update:model-value="
                            toggleRole(editForm.roles, role, $event)
                        "
                    />
                </div>
            </div>
            <BaseCheckbox v-model="editForm.isActive" label="Active" />
        </div>
        <template #footer>
            <BaseButton
                variant="outline"
                :disabled="saving"
                @click="editModel = false"
                >Cancel</BaseButton
            >
            <BaseButton
                class="flex-1"
                :loading="saving"
                :disabled="!!editPasswordError"
                @click="updateUser"
                >Save</BaseButton
            >
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Pencil, Plus, Search, Users, X } from '@lucide/vue';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseCheckbox from '@/components/ui/BaseCheckbox.vue';
import Badge from '@/components/ui/Badge.vue';
import {
    fieldErrors,
    PASSWORD_HINT,
    passwordError,
    textError,
} from '@/utils/rules';
import { Color, useUIStore } from '@/stores/ui';
import { Role, useAuthStore } from '@/stores/auth';
import {
    ASSIGNABLE_ROLES,
    canGrantRole,
    canManageUser,
    STRING_LIMITS,
} from '@grocery-pos/contracts';
import { useListFetch, useListPaging } from '@/composables/useListFetch';
import { apiErrorMessages } from '@/utils/api-error';

const { page, limit, search } = useListPaging(() => fetchUsers());
const totalItems = ref(0);
const searchName = ref('');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const serverItems = ref<any[]>([]);

const uiStore = useUIStore();
const saving = ref(false);

const authStore = useAuthStore();
const myRoles = computed(() => authStore.user?.roles ?? []);

// The server enforces all of this (issue #3); the form only hides what it
// would refuse. A user manager grants and manages only SELLER, ADJUSTER
// and RESTOCKER (MANAGEABLE_ROLES); ADMIN and USER_MANAGER holders are
// admin-only. Nobody changes their own roles, and only an admin resets
// someone else's password.
const roleOptions = ASSIGNABLE_ROLES;
const grantableRoles = computed(() =>
    roleOptions.filter((role) => canGrantRole(myRoles.value, role)),
);

function canEdit(item: { name?: string; roles?: Role[] }): boolean {
    return (
        item.name === authStore.user?.username ||
        canManageUser(myRoles.value, item.roles ?? [])
    );
}

const headers = [
    { key: 'name', title: 'Name' },
    { key: 'roles', title: 'Roles' },
    { key: 'isActive', title: 'Status' },
    { key: 'actions', title: 'Actions', align: 'right' as const },
];

const isCreateOpen = ref(false);
const createForm = ref({ name: '', password: '', roles: [] as Role[] });

const isEditOpen = ref(false);

/**
 * The dialogs' v-model: Escape, the backdrop and Cancel cannot close one
 * while its save is in flight (as the save dialogs, issue #18).
 */
function guardedOpen(open: typeof isCreateOpen) {
    return computed({
        get: () => open.value,
        set: (value: boolean) => {
            if (!value && saving.value) return;
            open.value = value;
        },
    });
}
const createModel = guardedOpen(isCreateOpen);
const editModel = guardedOpen(isEditOpen);
const editForm = ref({
    _id: '',
    name: '',
    password: '',
    roles: [] as Role[],
    isActive: true,
});

const isEditingSelf = computed(
    () => editForm.value.name === authStore.user?.username,
);
const canResetPassword = computed(
    () => authStore.isAdmin && !isEditingSelf.value,
);

const createPasswordError = computed(() =>
    passwordError(createForm.value.password),
);
const editPasswordError = computed(() =>
    canResetPassword.value ? passwordError(editForm.value.password, true) : '',
);

function toggleRole(list: Role[], role: Role, checked: boolean) {
    if (checked) {
        if (!list.includes(role)) list.push(role);
    } else {
        const i = list.indexOf(role);
        if (i > -1) list.splice(i, 1);
    }
}

const resetFilters = () => {
    searchName.value = '';
    search();
};

const {
    loading,
    error: loadError,
    load: fetchUsers,
} = useListFetch(
    () =>
        api.get(`/users`, {
            params: {
                page: page.value,
                limit: limit.value,
                name: searchName.value?.toLowerCase(),
            },
        }),
    (result) => {
        serverItems.value = result.data.data;
        totalItems.value = result.data.totalItems;
    },
    'Could not load the users.',
);

fetchUsers();

/** Why each create field would be refused, set when Save is pressed. */
const createErrors = ref<Record<string, string>>({});

/**
 * The API's `CreateFields` rules (issue #20): a username, trimmed, of at
 * most `STRING_LIMITS.USERNAME`; the password policy; at least one role.
 */
function createFormErrors(): Record<string, string> {
    return fieldErrors({
        name: textError(createForm.value.name, STRING_LIMITS.USERNAME),
        password: passwordError(createForm.value.password),
        roles: createForm.value.roles.length ? '' : 'Pick at least one role',
    });
}

/** Opens the Add User dialog empty: an earlier Cancel kept nothing. */
function openCreate() {
    createForm.value = { name: '', password: '', roles: [] };
    createErrors.value = {};
    isCreateOpen.value = true;
}

async function createUser() {
    if (saving.value) return;
    createErrors.value = createFormErrors();
    if (Object.keys(createErrors.value).length) return;
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
        uiStore.queueMessage(
            Color.ERROR,
            apiErrorMessages(error, 'Could not create the user.'),
        );
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
        // A new array (issue #20): ticking roles edits this copy, never
        // the table row, so Cancel leaves the row as it was. It also drops
        // roles that can't be stored (e.g. UNAUTHENTICATED on legacy
        // documents), so saving cleans them up.
        roles: (item.roles ?? []).filter((role: Role) =>
            ASSIGNABLE_ROLES.includes(role),
        ),
        isActive: item.isActive ?? true,
    };
    isEditOpen.value = true;
}

async function updateUser() {
    saving.value = true;
    try {
        const update: Record<string, unknown> = {
            isActive: editForm.value.isActive,
        };
        if (!isEditingSelf.value) update.roles = editForm.value.roles;
        if (canResetPassword.value && editForm.value.password) {
            update.password = editForm.value.password;
        }

        await api.patch('/users', {
            updates: [{ user: editForm.value._id, update }],
        });
        uiStore.queueMessage(Color.SUCCESS, 'User updated');
        isEditOpen.value = false;
        fetchUsers();
    } catch (error) {
        uiStore.queueMessage(
            Color.ERROR,
            apiErrorMessages(error, 'Could not update the user.'),
        );
    } finally {
        saving.value = false;
    }
}
</script>
