<template>
    <PageCard title="Product List">
        <template #icon>
            <List class="w-5 h-5 text-primary-600" />
        </template>
        <template #actions>
            <BaseButton
                size="sm"
                @click="router.push({ name: 'Products/Add' })"
            >
                <Plus class="w-4 h-4" />
                Add Products
            </BaseButton>
        </template>

        <div
            class="px-5 py-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 md:grid-cols-4 gap-3"
        >
            <BaseInput
                v-model="searchEAN"
                label="EAN / Barcode"
                clearable
                @enter="search"
                @clear="search"
            />
            <BaseInput
                v-model="searchName"
                label="Product Name"
                clearable
                @enter="search"
                @clear="search"
            />
            <div class="md:col-span-2 flex items-end gap-2">
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
            empty-text="No products found"
            :items-length="totalItems"
            @retry="fetchProducts"
        >
            <template #cell-price="{ value }">
                <span class="font-medium">{{
                    formatCurrency(value ?? 0)
                }}</span>
            </template>
        </BaseTable>
    </PageCard>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { List, Plus, Search, X } from '@lucide/vue';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { formatCurrency } from '@/utils/currency';
import { useListFetch, useListPaging } from '@/composables/useListFetch';

const router = useRouter();
const { page, limit, search } = useListPaging(() => fetchProducts());
const totalItems = ref(0);
const searchName = ref('');
const searchEAN = ref('');

const headers = [
    { key: 'EAN', title: 'EAN' },
    { key: 'name', title: 'Name' },
    { key: 'price', title: 'Price', align: 'right' as const },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const serverItems = ref<any[]>([]);

const resetFilters = () => {
    searchEAN.value = '';
    searchName.value = '';
    search();
};

const {
    loading,
    error: loadError,
    load: fetchProducts,
} = useListFetch(
    () =>
        api.get(`/products`, {
            params: {
                page: page.value,
                limit: limit.value,
                name: searchName.value?.toUpperCase(),
                EAN: searchEAN.value,
            },
        }),
    (result) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serverItems.value = result.data.data.map((product: any) => ({
            id: product._id,
            EAN: product.EAN,
            name: product.name,
            price: product.price,
        }));

        totalItems.value = result.data.totalItems;
    },
    'Could not load the products.',
);

fetchProducts();
</script>
