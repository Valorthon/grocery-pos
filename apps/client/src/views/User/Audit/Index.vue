<template>
    <PageCard title="Audit Log">
        <div class="p-5 space-y-4">
            <p class="text-sm">
                Sensitive actions recorded from deployment onward. Entries
                cannot be edited or deleted through the app. No automatic expiry
                is configured.
            </p>
            <div class="flex flex-wrap items-end gap-3">
                <BaseInput
                    v-model="actor"
                    label="Actor user ID"
                    @keydown.enter="search"
                />
                <label class="text-sm"
                    >Action<select
                        v-model="action"
                        class="block min-h-11 border rounded px-3"
                        @change="search"
                    >
                        <option value="">All actions</option>
                        <option
                            v-for="value in actions"
                            :key="value"
                            :value="value"
                        >
                            {{ AUDIT_ACTION_LABELS[value] }}
                        </option>
                    </select></label
                >
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
            <p v-if="validation" role="alert" class="text-sm text-red-700">
                {{ validation }}
            </p>
            <p v-if="error" role="alert" class="text-sm text-red-700">
                {{ error }} <BaseButton @click="load">Retry</BaseButton>
            </p>
            <p v-if="loading">Loading audit log…</p>
            <div v-else class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead>
                        <tr>
                            <th>When</th>
                            <th>Actor</th>
                            <th>Action</th>
                            <th>Target</th>
                            <th>Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in rows" :key="row._id" class="border-t">
                            <td class="py-3">
                                {{ formatStoreDateTime(row.createdAt) }}
                            </td>
                            <td>{{ row.actor?.name ?? 'Unauthenticated' }}</td>
                            <td>
                                {{
                                    AUDIT_ACTION_LABELS[row.action] ??
                                    row.action
                                }}
                            </td>
                            <td>{{ row.target.model }} {{ row.target.id }}</td>
                            <td>
                                <BaseButton
                                    variant="outline"
                                    @click="selected = row"
                                    >View</BaseButton
                                >
                            </td>
                        </tr>
                    </tbody>
                </table>
                <p v-if="!rows.length && !error">No matching audit events.</p>
            </div>
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
                    Target: {{ selected.target.model }} {{ selected.target.id }}
                </p>
                <p>
                    Approved by: {{ selected.approvedBy ?? 'Not applicable' }}
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
    </PageCard>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
    AUDIT_ACTION_LABELS,
    AuditAction,
    type AuditLogView,
    type Paginated,
} from '@grocery-pos/contracts';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import { apiErrorText } from '@/utils/api-error';
import { dateRangeError } from '@/utils/rules';
import { formatStoreDateTime } from '@/utils/datetime';
import { useAuthStore } from '@/stores/auth';
const auth = useAuthStore();
const actor = ref(''),
    action = ref(''),
    from = ref(''),
    to = ref(''),
    page = ref(1),
    total = ref(0),
    error = ref(''),
    validation = ref(''),
    loading = ref(false);
const rows = ref<AuditLogView[]>([]),
    selected = ref<AuditLogView | null>(null);
const actions = Object.values(AuditAction);
const rangeError = computed(() => dateRangeError(from.value, to.value));
let applied: { actor?: string; action?: string; from?: string; to?: string } =
        {},
    generation = 0;
function search() {
    validation.value = rangeError.value;
    if (validation.value) return;
    if (actor.value && !/^[a-fA-F0-9]{24}$/.test(actor.value)) {
        validation.value = 'Enter a valid user ID.';
        return;
    }
    applied = {
        actor: actor.value || undefined,
        action: action.value || undefined,
        from: from.value || undefined,
        to: to.value || undefined,
    };
    page.value = 1;
    void load();
}
function clear() {
    actor.value = '';
    action.value = '';
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
            params: { ...applied, page: page.value, limit: 20 },
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
