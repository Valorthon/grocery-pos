<template>
    <v-card elevation="2" class="rounded-lg border">
        <v-card-title class="d-flex align-center px-4 py-3 bg-grey-lighten-4">
            <v-icon
                icon="mdi-package-variant-closed"
                color="amber-darken-2"
                class="me-2"
            />
            <span class="text-subtitle-1 font-weight-bold">Inventory</span>
            <v-spacer />
            <div class="d-flex ga-2">
                <v-btn
                    color="amber-darken-2"
                    variant="flat"
                    prepend-icon="mdi-pencil"
                    size="small"
                    :to="{
                        name: 'Adjustments/Add',
                    }"
                >
                    Adjust
                </v-btn>
            </div>
        </v-card-title>

        <v-divider />

        <v-card-text class="bg-grey-lighten-5 pt-4">
            <v-row align="center">
                <v-col cols="12" md="3">
                    <v-text-field
                        v-model="searchEAN"
                        label="EAN / Barcode"
                        prepend-inner-icon="mdi-barcode-scan"
                        variant="outlined"
                        density="compact"
                        bg-color="white"
                        hide-details
                        color="amber-darken-2"
                        clearable
                        @update:model-value="resetSearch"
                    />
                </v-col>
                <v-col cols="12" md="3">
                    <v-text-field
                        v-model="searchName"
                        label="Product Name"
                        prepend-inner-icon="mdi-magnify"
                        variant="outlined"
                        density="compact"
                        bg-color="white"
                        hide-details
                        color="amber-darken-2"
                        clearable
                        @update:model-value="resetSearch"
                    />
                </v-col>
                <v-spacer />

                <v-col cols="12" md="2">
                    <v-btn
                        color="grey-darken-2"
                        variant="tonal"
                        prepend-icon="mdi-filter-remove-outline"
                        block
                        @click="resetFilters"
                    >
                        Clear Filters
                    </v-btn>
                </v-col>
            </v-row>
        </v-card-text>

        <v-divider />

        <v-data-table-server
            v-model:items-per-page="limit"
            v-model:page="page"
            :headers="headers"
            :items="serverItems"
            :items-length="totalItems"
            :loading="loading"
            hover
            @update:options="fetchInventory"
        >
            <template #loading>
                <v-skeleton-loader type="table-row@5" />
            </template>
        </v-data-table-server>
    </v-card>
</template>

<script setup lang="ts">
import api from '@/axios';
import { ref } from 'vue';

const loading = ref(true);
const limit = ref(5);
const page = ref(1);
const totalItems = ref(0);
const searchName = ref('');
const searchEAN = ref('');
const searchStock = ref();

const headers = ref([
    { title: 'EAN', align: 'start' as const, sortable: false, key: 'EAN' },
    { title: 'Name', key: 'name', align: 'start' as const, sortable: false },
    { title: 'Stock', key: 'stock', align: 'start' as const, sortable: false },
]);

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
            maxStock: searchStock.value,
        },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = result.data.data.map((inventory: any) => {
        return {
            id: inventory.product._id,
            EAN: inventory.product.EAN,
            name: inventory.product.name,
            stock: inventory.stock,
        };
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data.sort((a: any, b: any) => {
        return a['name'].localeCompare(b['name']);
    });

    serverItems.value = data;

    totalItems.value = result.data.totalItems;
    loading.value = false;
}
</script>
