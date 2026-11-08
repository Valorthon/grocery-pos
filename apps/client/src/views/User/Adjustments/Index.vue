<template>
    <PageFrame>
        <template #actions>
            <BaseButton
                size="sm"
                @click="router.push({ name: 'Adjustments/Add' })"
            >
                <Pencil class="w-4 h-4" />
                Adjust
            </BaseButton>
        </template>
        <PageCard>
            <FilterBar
                :searchable="false"
                :chips="chips"
                initially-open
                class="px-5 py-4 border-b border-line"
                @remove="removeFilter"
                @clear="resetFilters"
            >
                <BaseSelect
                    v-model="searchAdjustedBy"
                    :options="userOptions"
                    label="Adjusted By"
                    all-label="All users"
                    @update:model-value="applyFilters"
                />
                <BaseInput
                    v-model="searchDateStart"
                    label="From"
                    type="date"
                    :max="searchDateEnd || undefined"
                    @update:model-value="applyFilters"
                />
                <BaseInput
                    v-model="searchDateEnd"
                    label="To"
                    type="date"
                    :min="searchDateStart || undefined"
                    :error="rangeError"
                    @update:model-value="applyFilters"
                />
                <div class="flex items-end">
                    <BaseButton
                        variant="outline"
                        class="min-h-11"
                        @click="resetFilters"
                    >
                        <X class="w-4 h-4" />
                        Clear Filters
                    </BaseButton>
                </div>
            </FilterBar>

            <BaseTable
                v-model:page="page"
                v-model:items-per-page="limit"
                :headers="headers"
                :items="serverItems"
                :loading="loading"
                :error="loadError"
                empty-text="No adjustments found"
                :items-length="totalItems"
                row-click
                @click:row="showDetails"
                @retry="fetchAdjust"
            />
        </PageCard>
    </PageFrame>

    <BaseModal
        v-model="isDialogOpen"
        title="Adjustment Details"
        max-width="44rem"
        scrollable
    >
        <AdjustDetails v-if="selectedItem" :item="selectedItem" />
    </BaseModal>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Pencil, X } from '@lucide/vue';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import PageFrame from '@/components/ui/PageFrame.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import FilterBar from '@/components/ui/FilterBar.vue';
import type { FilterChip } from '@/components/ui/page-primitives';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import { useListFetch, useListPaging } from '@/composables/useListFetch';
import { dateRangeError } from '@/utils/rules';
import { Color, useUIStore } from '@/stores/ui';
import { apiErrorMessages } from '@/utils/api-error';
import { formatStoreDateTime } from '@/utils/datetime';
import type { Paginated, AdjustmentRow, UserRef } from '@grocery-pos/contracts';
import type { AdjustmentListRow } from '@/components/User/Adjustments/rows';
import AdjustDetails from '@/components/User/Adjustments/DetailsDialog.vue';

const router = useRouter();
const sourceId = computed(() => {
    const candidate = router.currentRoute?.value.query.source;
    return typeof candidate === 'string' && /^[a-f0-9]{24}$/i.test(candidate)
        ? candidate
        : undefined;
});
const uiStore = useUIStore();
const { page, limit, search } = useListPaging(() => fetchAdjust());
const totalItems = ref(0);
const serverItems = ref<AdjustmentListRow[]>([]);

const headers = [
    { key: 'description', title: 'Description' },
    { key: 'adjustedBy', title: 'Adjusted By' },
    { key: 'date', title: 'Date' },
];

const searchAdjustedBy = ref<string | null>(null);
const searchDateStart = ref('');
const searchDateEnd = ref('');
const userOptions = ref<Array<{ label: string; value: string }>>([]);

// Only fills the filter's options: a failure is a toast, and the list
// itself still loads.
const fetchUserOptions = async () => {
    try {
        const result = await api.get<UserRef[]>('/adjustments/users');
        userOptions.value = result.data.map(({ _id, name }) => ({
            label: name,
            value: _id,
        }));
    } catch (error) {
        uiStore.queueMessage(
            Color.ERROR,
            apiErrorMessages(error, 'Could not load the user filter.'),
        );
    }
};

onMounted(() => {
    void fetchUserOptions();
});

const rangeError = computed(() =>
    dateRangeError(searchDateStart.value, searchDateEnd.value),
);

/**
 * The filters the list was last loaded with: paging and Retry reuse them,
 * so a reversed range still being typed is never sent.
 */
const applied = ref({
    adjustedBy: undefined as string | undefined,
    // Calendar days as YYYY-MM-DD (the date input's value). The server
    // reads them in the store timezone; either may be blank.
    dateFrom: undefined as string | undefined,
    dateTo: undefined as string | undefined,
});

/**
 * A filter changed: list page 1 with it, once. A reversed date range is
 * shown on the To field and not sent (the API would refuse it): while it
 * is, the list keeps its last valid range, and a user pick still applies
 * with that range.
 */
const applyFilters = () => {
    const reversed = !!rangeError.value;
    const adjustedBy = searchAdjustedBy.value ?? undefined;
    if (reversed && adjustedBy === applied.value.adjustedBy) return;
    applied.value = {
        adjustedBy,
        dateFrom: reversed
            ? applied.value.dateFrom
            : searchDateStart.value || undefined,
        dateTo: reversed
            ? applied.value.dateTo
            : searchDateEnd.value || undefined,
    };
    search();
};

// Chips read the applied snapshot and the deep link, never the inputs.
const chips = computed<FilterChip[]>(() => {
    const a = applied.value;
    const out: FilterChip[] = [];
    if (a.adjustedBy)
        out.push({
            key: 'adjustedBy',
            label: `Adjusted by: ${userOptions.value.find((o) => o.value === a.adjustedBy)?.label ?? a.adjustedBy}`,
            inPanel: true,
        });
    if (a.dateFrom)
        out.push({
            key: 'dateFrom',
            label: `From: ${a.dateFrom}`,
            inPanel: true,
        });
    if (a.dateTo)
        out.push({ key: 'dateTo', label: `To: ${a.dateTo}`, inPanel: true });
    if (sourceId.value)
        out.push({ key: 'source', label: `Source: ${sourceId.value}` });
    return out;
});

/** Drops one applied filter with exactly one reload. */
function removeFilter(key: string) {
    if (key === 'source') {
        // The route watcher performs the single reload.
        void router.replace({
            query: { ...router.currentRoute.value.query, source: undefined },
        });
        return;
    }
    // The inputs go back to the applied range first, so a reversed range
    // still being typed never applies.
    searchAdjustedBy.value = applied.value.adjustedBy ?? null;
    searchDateStart.value = applied.value.dateFrom ?? '';
    searchDateEnd.value = applied.value.dateTo ?? '';
    if (key === 'adjustedBy') searchAdjustedBy.value = null;
    if (key === 'dateFrom') searchDateStart.value = '';
    if (key === 'dateTo') searchDateEnd.value = '';
    applied.value = {
        adjustedBy: searchAdjustedBy.value ?? undefined,
        dateFrom: searchDateStart.value || undefined,
        dateTo: searchDateEnd.value || undefined,
    };
    search();
}

const resetFilters = () => {
    searchAdjustedBy.value = null;
    searchDateStart.value = '';
    searchDateEnd.value = '';
    applied.value = {
        adjustedBy: undefined,
        dateFrom: undefined,
        dateTo: undefined,
    };
    if (sourceId.value) {
        // The route watcher performs the single reload after clearing the
        // deep link; other query parameters belong to the router.
        void router.replace({
            query: { ...router.currentRoute.value.query, source: undefined },
        });
    } else search();
};

const {
    loading,
    error: loadError,
    load: fetchAdjust,
} = useListFetch(
    () =>
        api.get<Paginated<AdjustmentRow>>(`/adjustments`, {
            params: {
                source: sourceId.value,
                page: page.value,
                limit: limit.value,
                ...applied.value,
            },
        }),
    (result) => {
        serverItems.value = result.data.data.map((adjust) => ({
            id: adjust._id,
            description: adjust.description,
            adjustedBy: adjust.adjustedBy?.name ?? 'N/A',
            date: formatStoreDateTime(adjust.createdAt),
        }));

        totalItems.value = result.data.totalItems;
    },
    'Could not load the adjustments.',
);

// Vue Router reuses this component for source links and ordinary sidebar
// navigation. Follow the current route without applying unsearched inputs.
watch(sourceId, () => search());

void fetchAdjust();

const isDialogOpen = ref(false);
const selectedItem = ref<AdjustmentListRow | null>(null);

function showDetails(row: AdjustmentListRow) {
    selectedItem.value = row;
    isDialogOpen.value = true;
}
</script>
