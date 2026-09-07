<template>
    <div class="flex-1 flex flex-col overflow-hidden bg-slate-100">
        <header
            class="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-5 bg-white border-b border-slate-200 gap-4"
        >
            <div>
                <h1
                    class="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight"
                >
                    Orders & Transactions
                </h1>
                <p class="text-xs sm:text-sm text-slate-500 mt-0.5">
                    View transaction history and reprint receipts
                </p>
            </div>

            <div class="flex items-center gap-3">
                <div
                    class="bg-slate-50 border border-slate-200 px-3.5 py-1.5 rounded-xl text-right"
                >
                    <span
                        class="text-[10px] font-bold uppercase tracking-wider text-slate-500"
                        >Transactions</span
                    >
                    <p class="text-base font-extrabold text-slate-900">
                        {{ totalItems }}
                    </p>
                </div>
                <button
                    type="button"
                    class="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white text-xs sm:text-sm font-bold px-4 py-2 rounded-xl transition-all active:scale-[0.98] shadow-xs"
                    @click="router.push({ name: 'Sell' })"
                >
                    <Plus class="w-4 h-4" />
                    New Sale
                </button>
            </div>
        </header>

        <div class="flex-1 overflow-y-auto p-6">
            <BaseTable
                v-model:page="page"
                v-model:items-per-page="limit"
                :headers="headers"
                :items="serverItems"
                :loading="loading"
                empty-text="No orders found"
                :items-length="totalItems"
                row-click
                @click:row="showDetails"
            >
                <template #cell-amount="{ value }">
                    <span class="font-bold">{{ value }}</span>
                </template>
                <template #cell-paymentType="{ value }">
                    <Badge :color="value === 'CASH' ? 'success' : 'info'">{{
                        value
                    }}</Badge>
                </template>
            </BaseTable>
        </div>

        <BaseModal
            v-model="isDialogOpen"
            title="Sale Details"
            max-width="36rem"
            scrollable
        >
            <table class="w-full text-left border-collapse text-sm">
                <thead>
                    <tr
                        class="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"
                    >
                        <th class="py-2.5 px-4">Product</th>
                        <th class="py-2.5 px-4">Qty</th>
                        <th class="py-2.5 px-4 text-right">Unit Price</th>
                        <th class="py-2.5 px-4 text-right">Total</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    <tr v-if="detailsLoading">
                        <td colspan="4" class="py-4 text-center">
                            <Spinner class="mx-auto text-slate-400" />
                        </td>
                    </tr>
                    <tr v-for="d in details" :key="d._id">
                        <td class="py-3 px-4">
                            {{ d.product?.name ?? 'N/A' }}
                        </td>
                        <td class="py-3 px-4">{{ d.quantity }}</td>
                        <td class="py-3 px-4 text-right">
                            ₱{{ d.unitPrice?.toLocaleString() ?? 0 }}
                        </td>
                        <td class="py-3 px-4 text-right">
                            ₱{{
                                (
                                    (d.unitPrice ?? 0) * d.quantity
                                ).toLocaleString()
                            }}
                        </td>
                    </tr>
                </tbody>
            </table>
            <template #footer>
                <BaseButton variant="outline" @click="isDialogOpen = false"
                    >Close</BaseButton
                >
            </template>
        </BaseModal>
    </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Plus } from '@lucide/vue';
import api from '@/axios';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import Badge from '@/components/ui/Badge.vue';
import Spinner from '@/components/ui/Spinner.vue';

const router = useRouter();
const loading = ref(true);
const limit = ref(5);
const page = ref(1);
const totalItems = ref(0);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const serverItems = ref<any[]>([]);

const headers = [
    { key: 'cashier', title: 'Cashier' },
    { key: 'amount', title: 'Amount' },
    { key: 'paymentType', title: 'Payment' },
    { key: 'date', title: 'Date' },
];

async function fetchSales() {
    loading.value = true;
    const result = await api.get(`/sales`, {
        params: { page: page.value, limit: limit.value },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    serverItems.value = result.data.data.map((sale: any) => ({
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
    }));

    totalItems.value = result.data.totalItems;
    loading.value = false;
}

fetchSales();
watch([page, limit], fetchSales);

const isDialogOpen = ref(false);
const detailsLoading = ref(false);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const details = ref<any[]>([]);
const selectedId = ref('');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function showDetails(row: any) {
    selectedId.value = row.id;
    isDialogOpen.value = true;
    detailsLoading.value = true;
    try {
        const res = await api.get(`/sales/details/${row.id}`);
        details.value = res.data;
    } catch {
        details.value = [];
    } finally {
        detailsLoading.value = false;
    }
}
</script>
