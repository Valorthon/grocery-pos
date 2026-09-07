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
            empty-text="No adjustments found"
            :items-length="totalItems"
            row-click
            @click:row="showDetails"
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
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ClipboardEdit, Pencil, X } from '@lucide/vue';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import AdjustDetails from '@/components/User/Adjustments/DetailsDialog.vue';

const router = useRouter();
const loading = ref(true);
const limit = ref(5);
const totalItems = ref(0);
const page = ref(1);
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

const fetchUserOptions = async () => {
    const result = await api.get('/adjustments/users');
    userOptions.value = result.data.map(
        ({ _id, name }: { _id: string; name: string }) => ({
            label: name,
            value: _id,
        }),
    );
};

onMounted(() => {
    fetchUserOptions();
});

const resetSearch = () => {
    page.value = 1;
    fetchAdjust();
};

const resetFilters = () => {
    searchAdjustedBy.value = null;
    searchDateStart.value = '';
    searchDateEnd.value = '';
    resetSearch();
};

async function fetchAdjust() {
    loading.value = true;

    let dateRange: string[] | undefined;
    if (searchDateStart.value && searchDateEnd.value) {
        dateRange = [
            new Date(searchDateStart.value).toISOString(),
            new Date(searchDateEnd.value).toISOString(),
        ];
    }

    const result = await api.get(`/adjustments`, {
        params: {
            page: page.value,
            limit: limit.value,
            adjustedBy: searchAdjustedBy.value,
            dateRange,
        },
        paramsSerializer: { indexes: null },
    });

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
    loading.value = false;
}

fetchAdjust();

watch([page, limit], fetchAdjust);

const isDialogOpen = ref(false);
const selectedItem = ref();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function showDetails(row: any) {
    selectedItem.value = row;
    isDialogOpen.value = true;
}
</script>
