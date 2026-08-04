<template>
    <v-card elevation="0" class="rounded-lg">
        <v-card-title
            class="d-flex align-center px-4 py-3 bg-grey-lighten-4 border-bottom"
        >
            <v-icon
                icon="mdi-information-outline"
                color="amber-darken-2"
                class="me-2"
            />
            <span class="text-subtitle-1 font-weight-bold"
                >Restock Details</span
            >

            <v-spacer />

            <v-btn
                icon="mdi-close"
                variant="text"
                density="comfortable"
                color="grey-darken-1"
                @click="$emit('close')"
            />
        </v-card-title>

        <v-divider />

        <v-card-text class="pa-0">
            <div class="px-5 py-4 bg-white">
                <v-row>
                    <v-col cols="12" sm="6" md="3">
                        <div
                            class="text-caption text-uppercase text-grey-darken-1 font-weight-bold mb-1"
                        >
                            Description
                        </div>
                        <div class="text-body-1">
                            {{ item.description || 'N/A' }}
                        </div>
                    </v-col>

                    <v-col cols="12" sm="6" md="3">
                        <div
                            class="text-caption text-uppercase text-grey-darken-1 font-weight-bold mb-1"
                        >
                            Restocked By
                        </div>
                        <div class="text-body-1 text-capitalize">
                            {{ item.restockedBy || 'Unknown' }}
                        </div>
                    </v-col>

                    <v-col cols="12" sm="6" md="3">
                        <div
                            class="text-caption text-uppercase text-grey-darken-1 font-weight-bold mb-1"
                        >
                            Date
                        </div>
                        <div class="text-body-1">{{ item.date || '--' }}</div>
                    </v-col>

                    <v-col cols="12" sm="6" md="3">
                        <div
                            class="text-caption text-uppercase text-grey-darken-1 font-weight-bold mb-1"
                        >
                            Grand Total
                        </div>
                        <div
                            class="text-body-1 font-weight-bold text-amber-darken-3"
                        >
                            {{ item.totalCost }}
                        </div>
                    </v-col>
                </v-row>
            </div>

            <v-divider />

            <div class="px-4 pt-4 pb-2 bg-grey-lighten-5">
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
                            @keyup.enter="resetSearch"
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
                            @keyup.enter="resetSearch"
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
            </div>

            <v-divider />

            <v-data-table-server
                v-model:items-per-page="limit"
                v-model:page="page"
                :headers="headers"
                :items="serverItems"
                :items-length="totalItems"
                :loading="loading"
                hover
                @update:options="fetchDetails"
            >
                <template #loading>
                    <v-skeleton-loader type="table-row@5" />
                </template>
            </v-data-table-server>
        </v-card-text>
    </v-card>
</template>

<script setup lang="ts">
import api from '@/axios';
import { ref } from 'vue';

defineEmits(['close']);

const props = defineProps<{
    item: {
        id: string;
        description: string;
        restockedBy: string;
        totalCost: number;
        date: Date;
    };
}>();

const loading = ref(true);
const limit = ref(5);
const totalItems = ref(0);
const page = ref(1);
const searchName = ref('');
const searchEAN = ref('');

const headers = ref([
    { title: 'Name', key: 'name', align: 'start' as const, sortable: false },
    {
        title: 'Quantity',
        key: 'quantity',
        align: 'start' as const,
        sortable: false,
    },
    {
        title: 'Unit Cost',
        key: 'unitCost',
        align: 'start' as const,
        sortable: false,
    },
    {
        title: 'totalCost',
        key: 'totalCost',
        align: 'start' as const,
        sortable: false,
    },
]);

const serverItems = ref([]);

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
    const result = await api.get(`/restocks/details/${props.item.id}`, {
        params: {
            page: page.value,
            limit: limit.value,
            name: searchName.value?.toUpperCase(),
            EAN: searchEAN.value,
        },
    });

    console.log({ result });
    serverItems.value = result.data.data.map(
        (details: {
            id: string | number;
            product?: { name: string };
            quantity: number;
            unitCost: number;
        }) => {
            return {
                id: details.id,
                name: details.product?.name,
                quantity: details.quantity,
                unitCost: details.unitCost,
                totalCost: details.unitCost * details.quantity,
            };
        },
    );

    totalItems.value = result.data.totalItems;
    console.log(totalItems.value);
    loading.value = false;
}
</script>
