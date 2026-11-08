<template>
    <PageFrame>
        <div class="space-y-4">
            <p class="text-sm">
                Sensitive actions recorded from deployment onward. Entries
                cannot be edited or deleted through the app. No automatic expiry
                is configured.
            </p>
            <div class="flex flex-wrap items-end gap-3">
                <div>
                    <BaseInput
                        v-model="username"
                        label="Username"
                        :maxlength="STRING_LIMITS.USERNAME"
                        clearable
                        aria-describedby="audit-username-hint"
                        @keydown.enter="search"
                        @clear="search"
                    />
                    <p id="audit-username-hint" class="text-xs text-muted">
                        Current username. Also finds that account's entries
                        under earlier names, and failed logins typed with this
                        name.
                    </p>
                </div>
                <BaseSelect
                    v-model="action"
                    class="w-56"
                    label="Action"
                    all-label="All actions"
                    :options="actionOptions"
                    @update:model-value="search"
                />
                <BaseInput
                    v-model="from"
                    label="From"
                    type="date"
                    @change="search"
                />
                <BaseInput
                    v-model="to"
                    label="To"
                    type="date"
                    :error="rangeError"
                    @change="search"
                />
                <BaseButton :disabled="loading" @click="search"
                    >Search</BaseButton
                >
                <BaseButton variant="outline" :disabled="loading" @click="clear"
                    >Clear Filters</BaseButton
                >
            </div>
            <p v-if="validation" role="alert" class="text-sm text-danger-fg">
                {{ validation }}
            </p>
            <BaseTable
                :headers="headers"
                :items="tableRows"
                :loading="loading"
                :error="error"
                @retry="load"
            >
                <template #cell-when="{ item }">
                    {{ formatStoreDateTime(item.createdAt) }}
                </template>
                <template #cell-actor="{ item }">
                    {{ item.actor?.name ?? 'Unauthenticated' }}
                </template>
                <template #cell-action="{ item }">
                    {{ AUDIT_ACTION_LABELS[item.action] ?? item.action }}
                </template>
                <template #cell-target="{ item }">
                    {{ item.target.model }} {{ item.target.id }}
                </template>
                <template #cell-details="{ item }">
                    <BaseButton
                        size="sm"
                        variant="outline"
                        @click="selected = item"
                        >View</BaseButton
                    >
                </template>
                <template #empty>
                    <EmptyState
                        title="No matching audit events."
                        hint="Try other filters or clear them."
                    >
                        <template #icon><ScrollText :size="24" /></template>
                    </EmptyState>
                </template>
            </BaseTable>
            <div v-if="!error" class="flex items-center gap-3 text-sm">
                <BaseButton
                    variant="outline"
                    :disabled="loading || page === 1"
                    @click="
                        page--;
                        load();
                    "
                    >Previous</BaseButton
                ><span>Page {{ page }} · {{ total }} events</span
                ><BaseButton
                    variant="outline"
                    :disabled="loading || page * 20 >= total"
                    @click="
                        page++;
                        load();
                    "
                    >Next</BaseButton
                >
            </div>
        </div>
        <BaseModal
            v-if="selected"
            :model-value="true"
            title="Audit event"
            scrollable
            @update:model-value="
                (value) => {
                    if (!value) selected = null;
                }
            "
        >
            <div class="p-5 space-y-3 text-sm">
                <p>
                    {{
                        AUDIT_ACTION_LABELS[selected.action] ?? selected.action
                    }}
                    ·
                    {{ formatStoreDateTime(selected.createdAt) }}
                </p>
                <p>
                    Actor: {{ selected.actor?.name ?? 'Unauthenticated' }}
                    {{ selected.actor?._id }}
                </p>
                <p>
                    Target: {{ selected.target.model }}
                    {{ selected.target.id }}
                </p>
                <p>
                    Approved by:
                    {{ selected.approvedBy ?? 'Not applicable' }}
                </p>
                <p>IP: {{ selected.ip ?? 'Unavailable' }}</p>
                <p>User agent: {{ selected.userAgent ?? 'Unavailable' }}</p>
                <h3 class="font-semibold">Before</h3>
                <pre class="whitespace-pre-wrap break-words">{{
                    JSON.stringify(selected.before, null, 2)
                }}</pre>
                <h3 class="font-semibold">After</h3>
                <pre class="whitespace-pre-wrap break-words">{{
                    JSON.stringify(selected.after, null, 2)
                }}</pre>
            </div>
        </BaseModal>
    </PageFrame>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
    AUDIT_ACTION_LABELS,
    AuditAction,
    STRING_LIMITS,
    type AuditListQuery,
    type AuditLogView,
    type Paginated,
} from '@grocery-pos/contracts';
import api from '@/axios';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import type { TableHeader } from '@/components/ui/types';
import { ScrollText } from '@lucide/vue';
import PageFrame from '@/components/ui/PageFrame.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import { apiErrorText } from '@/utils/api-error';
import { dateRangeError } from '@/utils/rules';
import { formatStoreDateTime } from '@/utils/datetime';
import { useAuthStore } from '@/stores/auth';
const auth = useAuthStore();
const username = ref(''),
    action = ref<AuditAction | null>(null),
    from = ref(''),
    to = ref(''),
    page = ref(1),
    total = ref(0),
    error = ref(''),
    validation = ref(''),
    loading = ref(false);
const rows = ref<AuditLogView[]>([]),
    selected = ref<AuditLogView | null>(null);
const actionOptions = Object.values(AuditAction).map((value) => ({
    value,
    label: AUDIT_ACTION_LABELS[value],
}));
const headers: TableHeader[] = [
    { key: 'when', title: 'When' },
    { key: 'actor', title: 'Actor' },
    { key: 'action', title: 'Action' },
    { key: 'target', title: 'Target' },
    { key: 'details', title: 'Details' },
];
const tableRows = computed(() =>
    rows.value.map((row) => ({ ...row, id: row._id })),
);
const rangeError = computed(() => dateRangeError(from.value, to.value));
let applied: Omit<AuditListQuery, 'page' | 'limit'> = {},
    generation = 0;
function search() {
    validation.value = rangeError.value;
    if (validation.value) return;
    applied = {
        username: username.value.trim() || undefined,
        action: action.value || undefined,
        from: from.value || undefined,
        to: to.value || undefined,
    };
    page.value = 1;
    void load();
}
function clear() {
    username.value = '';
    action.value = null;
    from.value = '';
    to.value = '';
    search();
}
async function load() {
    if (!auth.isAdmin) return;
    const version = ++generation;
    loading.value = true;
    error.value = '';
    selected.value = null;
    try {
        const { data } = await api.get<Paginated<AuditLogView>>('/audit', {
            params: {
                ...applied,
                page: page.value,
                limit: 20,
            } satisfies AuditListQuery,
        });
        if (version !== generation) return;
        rows.value = data.data;
        total.value = data.totalItems;
    } catch (err) {
        if (version === generation) {
            rows.value = [];
            error.value = apiErrorText(err);
        }
    } finally {
        if (version === generation) loading.value = false;
    }
}
watch(
    () => [auth.user?.userId, auth.isAdmin],
    () => {
        generation++;
        rows.value = [];
        selected.value = null;
        error.value = '';
        loading.value = false;
    },
);
onMounted(load);
onBeforeUnmount(() => generation++);
</script>
