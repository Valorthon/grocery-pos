<template>
    <PageCard title="Adjustment History">
        <template #icon>
            <ClipboardEdit class="w-5 h-5 text-primary-600" />
        </template>
        <template #actions>
            <BaseButton
                size="sm"
                @click="router.push({ name: 'Adjustments/Add' })"
            >
                <Pencil class="w-4 h-4" />
                Adjust
            </BaseButton>
        </template>

        <div
            class="px-5 py-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 md:grid-cols-5 gap-3"
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
            <div class="md:col-span-2 flex items-end">
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
            empty-text="No adjustments found"
            :items-length="totalItems"
            row-click
            @click:row="showDetails"
            @retry="fetchAdjust"
        />
    </PageCard>

    <BaseModal
        v-model="isDialogOpen"
        title="Adjustment Details"
        max-width="44rem"
        scrollable
    >
        <AdjustDetails :item="selectedItem" />
    </BaseModal>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ClipboardEdit, Pencil, X } from '@lucide/vue';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import { useListFetch, useListPaging } from '@/composables/useListFetch';
import { dateRangeError } from '@/utils/rules';
import { Color, useUIStore } from '@/stores/ui';
import { apiErrorMessages } from '@/utils/api-error';
import AdjustDetails from '@/components/User/Adjustments/DetailsDialog.vue';

const router = useRouter();
const uiStore = useUIStore();
const { page, limit, search } = useListPaging(() => fetchAdjust());
const totalItems = ref(0);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const serverItems = ref<any[]>([]);

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
        const result = await api.get('/adjustments/users');
        userOptions.value = result.data.map(
            ({ _id, name }: { _id: string; name: string }) => ({
                label: name,
                value: _id,
            }),
        );
    } catch (error) {
        uiStore.queueMessage(
            Color.ERROR,
            apiErrorMessages(error, 'Could not load the user filter.'),
        );
    }
};

onMounted(() => {
    fetchUserOptions();
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

const resetFilters = () => {
    searchAdjustedBy.value = null;
    searchDateStart.value = '';
    searchDateEnd.value = '';
    applyFilters();
};

const {
    loading,
    error: loadError,
    load: fetchAdjust,
} = useListFetch(
    () =>
        api.get(`/adjustments`, {
            params: {
                page: page.value,
                limit: limit.value,
                ...applied.value,
            },
        }),
    (result) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serverItems.value = result.data.data.map((adjust: any) => ({
            id: adjust._id,
            description: adjust.description,
            adjustedBy: adjust.adjustedBy.name,
            date: new Date(adjust.createdAt).toLocaleString('en-PH', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
            }),
        }));

        totalItems.value = result.data.totalItems;
    },
    'Could not load the adjustments.',
);

fetchAdjust();

const isDialogOpen = ref(false);
const selectedItem = ref();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function showDetails(row: any) {
    selectedItem.value = row;
    isDialogOpen.value = true;
}
</script>
