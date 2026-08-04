<template>
    <v-card elevation="2" class="rounded-lg border">
        <v-card-title class="d-flex align-center px-4 py-3 bg-grey-lighten-4">
            <v-icon
                icon="mdi-receipt-text-outline"
                color="amber-darken-2"
                class="me-2"
            />
            <span class="text-subtitle-1 font-weight-bold">Sales History</span>
            <v-spacer />
            <div class="d-flex ga-2">
                <v-btn
                    color="amber-darken-2"
                    variant="flat"
                    prepend-icon="mdi-cart-plus"
                    size="small"
                    :to="{ name: 'Sell' }"
                >
                    New Sale
                </v-btn>
            </div>
        </v-card-title>

        <v-divider />

        <v-data-table-server
            v-model:items-per-page="limit"
            v-model:page="page"
            :headers="headers"
            :items="serverItems"
            :items-length="totalItems"
            :loading="loading"
            hover
            @update:options="fetchSales"
            @click:row="showDetails"
        >
            <template #loading>
                <v-skeleton-loader type="table-row@5" />
            </template>
        </v-data-table-server>

        <v-dialog v-model="isDialogOpen" max-width="600" destroy-on-close>
            <v-card rounded="xl" elevation="0" border>
                <v-card-title class="pa-5 text-subtitle-1 font-weight-bold">
                    Sale Details
                </v-card-title>
                <v-divider />
                <v-card-text class="pa-5">
                    <v-table density="comfortable">
                        <thead>
                            <tr>
                                <th class="text-left">Product</th>
                                <th class="text-left">Qty</th>
                                <th class="text-left">Unit Price</th>
                                <th class="text-left">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="detailsLoading">
                                <td colspan="4" class="text-center py-4">
                                    <v-progress-circular
                                        indeterminate
                                        size="24"
                                    />
                                </td>
                            </tr>
                            <tr v-for="d in details" :key="d._id">
                                <td>{{ d.product?.name ?? 'N/A' }}</td>
                                <td>{{ d.quantity }}</td>
                                <td>
                                    ₱{{ d.unitPrice?.toLocaleString() ?? 0 }}
                                </td>
                                <td>
                                    ₱{{
                                        (
                                            (d.unitPrice ?? 0) * d.quantity
                                        ).toLocaleString()
                                    }}
                                </td>
                            </tr>
                        </tbody>
                    </v-table>
                </v-card-text>
                <v-divider />
                <v-card-actions class="pa-5">
                    <v-spacer />
                    <v-btn variant="tonal" @click="isDialogOpen = false">
                        Close
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </v-card>
</template>

<script setup lang="ts">
import api from '@/axios';
import { ref } from 'vue';

const loading = ref(true);
const limit = ref(5);
const page = ref(1);
const totalItems = ref(0);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const serverItems = ref<any[]>([]);

const headers = ref([
    {
        title: 'Cashier',
        key: 'cashier',
        align: 'start' as const,
        sortable: false,
    },
    {
        title: 'Amount',
        key: 'amount',
        align: 'start' as const,
        sortable: false,
    },
    {
        title: 'Payment',
        key: 'paymentType',
        align: 'start' as const,
        sortable: false,
    },
    { title: 'Date', key: 'date', align: 'start' as const, sortable: false },
]);

async function fetchSales() {
    loading.value = true;
    const result = await api.get(`/sales`, {
        params: {
            page: page.value,
            limit: limit.value,
        },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    serverItems.value = result.data.data.map((sale: any) => {
        return {
            id: sale._id,
            cashier: sale.cashier?.name ?? 'N/A',
            amount: `₱${sale.amount?.toLocaleString() ?? 0}`,
            paymentType: sale.paymentType,
            date: new Date(sale.createdAt).toLocaleString('en-PH', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
            }),
        };
    });

    totalItems.value = result.data.totalItems;
    loading.value = false;
}

// Dialogue Box
const isDialogOpen = ref(false);
const detailsLoading = ref(false);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const details = ref<any[]>([]);
const selectedId = ref<string>('');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function showDetails(_event: Event, { item }: { item: any }) {
    selectedId.value = item.id;
    isDialogOpen.value = true;
    detailsLoading.value = true;
    try {
        const res = await api.get(`/sales/details/${item.id}`);
        details.value = res.data;
    } catch {
        details.value = [];
    } finally {
        detailsLoading.value = false;
    }
}
</script>
