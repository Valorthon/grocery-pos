<template>
    <PageCard title="Inventory">
        <template #icon>
            <Package class="w-5 h-5 text-primary-600" />
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
            empty-text="No inventory found"
            :items-length="totalItems"
        />
    </PageCard>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Package, Pencil, X } from '@lucide/vue';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';

const router = useRouter();
const loading = ref(true);
const limit = ref(5);
const page = ref(1);
const totalItems = ref(0);
const searchName = ref('');
const searchEAN = ref('');

const headers = [
    { key: 'EAN', title: 'EAN' },
    { key: 'name', title: 'Name' },
    { key: 'stock', title: 'Stock', align: 'right' as const },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const serverItems = ref<any[]>([]);

const resetSearch = () => {
    page.value = 1;
    fetchInventory();
};

const resetFilters = () => {
    searchEAN.value = '';
    searchName.value = '';
    resetSearch();
};

async function fetchInventory() {
    loading.value = true;
    const result = await api.get(`/inventories`, {
        params: {
            page: page.value,
            limit: limit.value,
            name: searchName.value?.toUpperCase(),
            EAN: searchEAN.value,
        },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = result.data.data.map((inventory: any) => ({
        id: inventory.product._id,
        EAN: inventory.product.EAN,
        name: inventory.product.name,
        stock: inventory.stock,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data.sort((a: any, b: any) => a.name.localeCompare(b.name));

    serverItems.value = data;
    totalItems.value = result.data.totalItems;
    loading.value = false;
}

fetchInventory();

watch([page, limit], fetchInventory);
</script>
