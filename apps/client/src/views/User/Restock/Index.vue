<template>
    <PageCard title="Restock History">
        <template #icon>
            <Truck class="w-5 h-5 text-primary-600" />
        </template>
        <template #actions>
            <BaseButton
                size="sm"
                @click="router.push({ name: 'Restocks/Add' })"
            >
                <Truck class="w-4 h-4" />
                Restock
            </BaseButton>
        </template>

        <div
            class="px-5 py-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 md:grid-cols-5 gap-3"
        >
            <BaseSelect
                v-model="searchRestockedBy"
                :options="userOptions"
                label="Restocked By"
            />
            <BaseInput
                v-model="searchDateStart"
                label="From"
                type="date"
                @update:model-value="resetSearch"
            />
            <BaseInput
                v-model="searchDateEnd"
                label="To"
                type="date"
                @update:model-value="resetSearch"
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
            empty-text="No restocks found"
            :items-length="totalItems"
            row-click
            @click:row="showDetails"
            @retry="fetchRestock"
        />
    </PageCard>

    <BaseModal
        v-model="isDialogOpen"
        title="Restock Details"
        max-width="52rem"
        scrollable
    >
        <RestockDetails :item="selectedItem" />
    </BaseModal>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Truck, X } from '@lucide/vue';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import { useListFetch } from '@/composables/useListFetch';
import { Color, useUIStore } from '@/stores/ui';
import { apiErrorMessages } from '@/utils/api-error';
import RestockDetails from '@/components/User/Restock/DetailsDialog.vue';
import { formatCurrency } from '@/utils/currency';

const router = useRouter();
const uiStore = useUIStore();
const limit = ref(5);
const totalItems = ref(0);
const page = ref(1);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const serverItems = ref<any[]>([]);

const headers = [
    { key: 'description', title: 'Description' },
    { key: 'totalCost', title: 'Total Cost', align: 'right' as const },
    { key: 'restockedBy', title: 'Restocked By' },
    { key: 'date', title: 'Date' },
];

const searchRestockedBy = ref<string | null>(null);
const searchDateStart = ref('');
const searchDateEnd = ref('');
const userOptions = ref<Array<{ label: string; value: string }>>([]);

// Only fills the filter's options: a failure is a toast, and the list
// itself still loads.
const fetchUserOptions = async () => {
    try {
        const result = await api.get('/restocks/users');
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

const resetSearch = () => {
    page.value = 1;
    fetchRestock();
};

const resetFilters = () => {
    searchRestockedBy.value = null;
    searchDateStart.value = '';
    searchDateEnd.value = '';
    resetSearch();
};

const {
    loading,
    error: loadError,
    load: fetchRestock,
} = useListFetch(
    () =>
        api.get(`/restocks`, {
            params: {
                page: page.value,
                limit: limit.value,
                restockedBy: searchRestockedBy.value,
                // Calendar days as YYYY-MM-DD (the date input's value). The
                // server reads them in the store timezone; either may be blank.
                dateFrom: searchDateStart.value || undefined,
                dateTo: searchDateEnd.value || undefined,
            },
        }),
    (result) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serverItems.value = result.data.data.map((restock: any) => ({
            id: restock._id,
            description: restock.description,
            restockedBy: restock.restockedBy.name,
            totalCost: formatCurrency(restock.totalCost ?? 0),
            date: new Date(restock.createdAt).toLocaleString('en-PH', {
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
    'Could not load the restocks.',
);

fetchRestock();

watch([page, limit], fetchRestock);

const isDialogOpen = ref(false);
const selectedItem = ref();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function showDetails(row: any) {
    selectedItem.value = row;
    isDialogOpen.value = true;
}
</script>
