<template>
    <PageFrame>
        <div class="space-y-4">
            <p class="text-sm">
                Recorded from deployment onward; earlier actions are not
                backfilled. No automatic expiry is configured.
            </p>
            <FilterBar
                v-model:search="username"
                search-label="Username"
                :maxlength="STRING_LIMITS.USERNAME"
                search-hint="Current username. Also finds that account's entries under earlier names, and failed logins typed with this name."
                compact
                :active="filtersActive"
                @search="search"
                @clear="clear"
            >
                <DateRangeFilter
                    v-model:from="from"
                    v-model:to="to"
                    :preset="datePreset"
                    :error="rangeError"
                    edit-on="change"
                    :limit-range="false"
                    @preset="pickPreset"
                    @edit="editDate"
                />
                <BaseSelect
                    v-model="action"
                    aria-label="Action"
                    all-label="All actions"
                    :options="actionOptions"
                    @update:model-value="search"
                />
            </FilterBar>
            <p v-if="validation" role="alert" class="text-sm text-danger-fg">
                {{ validation }}
            </p>
            <BaseTable
                :headers="headers"
                :items="tableRows"
                :loading="loading"
                :error="error"
                row-click
                @click:row="selected = $event"
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
                    {{ targetText(item.target) }}
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
            <div class="p-5 space-y-5 text-sm">
                <div
                    data-testid="audit-heading"
                    class="flex flex-wrap items-center gap-x-3 gap-y-1"
                >
                    <Badge color="primary" size="md">{{
                        AUDIT_ACTION_LABELS[selected.action] ?? selected.action
                    }}</Badge>
                    <span class="text-muted">{{
                        formatStoreDateTime(selected.createdAt)
                    }}</span>
                </div>
                <dl
                    data-testid="audit-details"
                    class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2"
                >
                    <dt class="font-semibold">Actor</dt>
                    <dd>
                        <span class="block">{{
                            selected.actor?.name ?? 'Unauthenticated'
                        }}</span>
                        <span
                            v-if="selected.actor"
                            class="flex items-center gap-1 text-xs text-muted font-mono"
                            >{{ elidedId(selected.actor._id) }}
                            <button
                                type="button"
                                class="inline-flex items-center justify-center min-h-11 min-w-11 -my-3 rounded focus-ring hover:text-ink"
                                aria-label="Copy actor ID"
                                @click="
                                    copyText(selected.actor._id, 'Actor ID')
                                "
                            >
                                <Copy :size="14" aria-hidden="true" /></button
                        ></span>
                    </dd>
                    <dt class="font-semibold">Target</dt>
                    <dd>
                        <span class="block">{{
                            targetText(selected.target)
                        }}</span>
                        <span
                            v-if="selected.target.id"
                            class="flex items-center gap-1 text-xs text-muted font-mono"
                            >{{ elidedId(selected.target.id) }}
                            <button
                                type="button"
                                class="inline-flex items-center justify-center min-h-11 min-w-11 -my-3 rounded focus-ring hover:text-ink"
                                aria-label="Copy target ID"
                                @click="
                                    copyText(selected.target.id, 'Target ID')
                                "
                            >
                                <Copy :size="14" aria-hidden="true" /></button
                        ></span>
                    </dd>
                    <dt class="font-semibold">Approved by</dt>
                    <dd>
                        {{
                            selected.approvedBy
                                ? (selected.approvedByName ??
                                  shortId(selected.approvedBy))
                                : '—'
                        }}
                    </dd>
                    <dt class="font-semibold">IP</dt>
                    <dd>{{ selected.ip ?? 'Unavailable' }}</dd>
                    <dt class="font-semibold">Device</dt>
                    <dd>
                        <template v-if="selected.userAgent">
                            <span class="block">{{
                                deviceSummary(selected.userAgent)
                            }}</span>
                            <details class="text-xs text-muted">
                                <summary class="cursor-pointer">
                                    Full user agent
                                </summary>
                                <p class="mt-1 break-words font-mono">
                                    {{ selected.userAgent }}
                                </p>
                            </details>
                        </template>
                        <template v-else>Unavailable</template>
                    </dd>
                </dl>
                <section aria-labelledby="audit-changes-title">
                    <h3
                        id="audit-changes-title"
                        class="text-xs font-semibold uppercase tracking-wide text-muted mb-2"
                    >
                        Changes
                    </h3>
                    <p v-if="!changes.length" class="text-muted">
                        No field changes recorded
                    </p>
                    <table
                        v-else
                        data-testid="audit-changes"
                        class="w-full text-left border-collapse"
                    >
                        <thead>
                            <tr class="border-b border-line text-muted">
                                <th
                                    scope="col"
                                    class="py-1.5 pr-3 font-semibold"
                                >
                                    Field
                                </th>
                                <th
                                    scope="col"
                                    class="py-1.5 pr-3 font-semibold"
                                >
                                    Before
                                </th>
                                <th scope="col" class="py-1.5 font-semibold">
                                    After
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="change in changes"
                                :key="change.key"
                                class="border-b border-line last:border-0 align-top"
                                :data-changed="change.changed ? '' : undefined"
                            >
                                <th scope="row" class="py-1.5 pr-3 font-normal">
                                    {{ change.field }}
                                </th>
                                <td class="py-1.5 pr-3 break-words">
                                    {{ change.before }}
                                </td>
                                <td
                                    :class="[
                                        'py-1.5 break-words',
                                        change.changed &&
                                            'font-semibold text-leaf-700',
                                    ]"
                                >
                                    {{ change.after
                                    }}<span
                                        v-if="change.changed"
                                        class="sr-only"
                                    >
                                        (changed)</span
                                    >
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </section>
            </div>
        </BaseModal>
    </PageFrame>
</template>
<script setup lang="ts">
import { AUDIT_HELP } from '../list-help';
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
import FilterBar from '@/components/ui/FilterBar.vue';
import DateRangeFilter from '@/components/ui/DateRangeFilter.vue';
import { useDatePreset } from '@/composables/useDatePreset';
import { type DatePreset } from '@/views/User/Reports/presets';
import BaseButton from '@/components/ui/BaseButton.vue';
import Badge from '@/components/ui/Badge.vue';
import { Copy } from '@lucide/vue';
import { copyText } from '@/utils/clipboard';
import { deviceSummary } from '@/utils/user-agent';
import { changeRows, elidedId, shortId, targetText } from './audit-view';
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
const changes = computed(() =>
    selected.value
        ? changeRows(selected.value.before, selected.value.after)
        : [],
);
const actionOptions = Object.values(AuditAction).map((value) => ({
    value,
    label: AUDIT_ACTION_LABELS[value],
}));
const headers: TableHeader[] = [
    { key: 'when', title: 'When' },
    { key: 'actor', title: 'Actor' },
    { key: 'action', title: 'Action', help: AUDIT_HELP.action },
    { key: 'target', title: 'Target', help: AUDIT_HELP.target },
];
const tableRows = computed(() =>
    rows.value.map((row) => ({ ...row, id: row._id })),
);
const rangeError = computed(() => dateRangeError(from.value, to.value));
const applied = ref<Omit<AuditListQuery, 'page' | 'limit'>>({});
let generation = 0;
const {
    preset: datePreset,
    choose: choosePreset,
    edited: presetEdited,
    reset: resetPreset,
} = useDatePreset(from, to, () => search());
/** A preset fills both dates, then searches once (#215). */
function pickPreset(value: string | null) {
    void choosePreset(value as DatePreset | null);
}
/** A manual date edit switches the preset to Custom and searches. */
function editDate() {
    presetEdited();
    search();
}
/** Clear Filters is enabled while any filter or preset is set. */
const filtersActive = computed(
    () =>
        !!(
            username.value.trim() ||
            action.value ||
            from.value ||
            to.value ||
            datePreset.value ||
            Object.values(applied.value).some(Boolean)
        ),
);
function search() {
    validation.value = rangeError.value;
    if (validation.value) return;
    applied.value = {
        username: username.value.trim() || undefined,
        action: action.value || undefined,
        from: from.value || undefined,
        to: to.value || undefined,
    };
    page.value = 1;
    void load();
}
function clear() {
    resetPreset();
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
                ...applied.value,
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
