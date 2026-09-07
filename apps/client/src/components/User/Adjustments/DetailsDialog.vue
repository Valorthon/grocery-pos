<template>
    <div>
        <div
            class="grid grid-cols-1 md:grid-cols-3 gap-4 px-5 py-4 border-b border-slate-100"
        >
            <div>
                <div
                    class="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1"
                >
                    Description
                </div>
                <div class="text-sm">{{ item.description || 'N/A' }}</div>
            </div>
            <div>
                <div
                    class="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1"
                >
                    Adjusted By
                </div>
                <div class="text-sm capitalize">
                    {{ item.adjustedBy || 'Unknown' }}
                </div>
            </div>
            <div>
                <div
                    class="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1"
                >
                    Date
                </div>
                <div class="text-sm">{{ item.date || '--' }}</div>
            </div>
        </div>

        <div
            class="px-5 py-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 md:grid-cols-4 gap-3"
        >
            <BaseInput
                v-model="searchEAN"
                label="EAN / Barcode"
                clearable
                @enter="resetSearch"
                @clear="resetSearch"
            />
            <BaseInput
                v-model="searchName"
                label="Product Name"
                clearable
                @enter="resetSearch"
                @clear="resetSearch"
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
            empty-text="No details found"
            :items-length="totalItems"
        />
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { X } from '@lucide/vue';
import api from '@/axios';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';

const props = defineProps<{
    item: { id: string; description: string; adjustedBy: string; date: Date };
}>();

const loading = ref(true);
const limit = ref(5);
const totalItems = ref(0);
const page = ref(1);
const searchName = ref('');
const searchEAN = ref('');

const headers = [
    { key: 'name', title: 'Name' },
    { key: 'change', title: 'Change', align: 'right' as const },
    { key: 'reason', title: 'Reason' },
];

const serverItems = ref<Array<Record<string, unknown>>>([]);

const resetSearch = () => {
    page.value = 1;
    fetchDetails();
};

const resetFilters = () => {
    searchEAN.value = '';
    searchName.value = '';
    resetSearch();
};

async function fetchDetails() {
    loading.value = true;
    const result = await api.get(`/adjustments/details/${props.item.id}`, {
        params: {
            page: page.value,
            limit: limit.value,
            name: searchName.value?.toUpperCase(),
            EAN: searchEAN.value,
        },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    serverItems.value = result.data.data.map((details: any) => ({
        id: details.id,
        name: details.product?.name,
        change: details.change,
        reason: details.reason,
    }));

    totalItems.value = result.data.totalItems;
    loading.value = false;
}

onMounted(fetchDetails);

watch([page, limit], fetchDetails);
</script>
