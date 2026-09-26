<template>
    <div>
        <div
            class="grid grid-cols-2 md:grid-cols-4 gap-4 px-5 py-4 border-b border-slate-100"
        >
            <div>
                <div
                    class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1"
                >
                    Description
                </div>
                <div class="text-sm">{{ item.description || 'N/A' }}</div>
            </div>
            <div>
                <div
                    class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1"
                >
                    Restocked By
                </div>
                <div class="text-sm capitalize">
                    {{ item.restockedBy || 'Unknown' }}
                </div>
            </div>
            <div>
                <div
                    class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1"
                >
                    Date
                </div>
                <div class="text-sm">{{ item.date || '--' }}</div>
            </div>
            <div>
                <div
                    class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1"
                >
                    Grand Total
                </div>
                <div class="text-sm font-bold text-primary-600">
                    {{ item.totalCost }}
                </div>
            </div>
        </div>

        <div
            class="px-5 py-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 md:grid-cols-4 gap-3"
        >
            <BaseInput
                v-model="searchEAN"
                label="EAN / Barcode"
                clearable
                @enter="applySearch"
                @clear="applySearch"
            />
            <BaseInput
                v-model="searchName"
                label="Product Name"
                clearable
                @enter="applySearch"
                @clear="applySearch"
            />
            <div class="md:col-span-2 flex items-end gap-2">
                <BaseButton size="sm" @click="applySearch">
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
            empty-text="No details found"
            :items-length="totalItems"
            @retry="fetchDetails"
        />
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Search, X } from '@lucide/vue';
import api from '@/axios';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import {
    useAppliedFilters,
    useListFetch,
    useListPaging,
} from '@/composables/useListFetch';
import { formatCurrency } from '@/utils/currency';
import type { Paginated, RestockLine } from '@grocery-pos/contracts';
import type { RestockListRow } from './rows';

const props = defineProps<{
    item: RestockListRow;
}>();

const { page, limit, search } = useListPaging(() => fetchDetails());
const totalItems = ref(0);
const searchName = ref('');
const searchEAN = ref('');
// What the list was last searched for: paging and Retry reuse it.
const { applied, apply: applySearch } = useAppliedFilters(
    () => ({ name: searchName.value, EAN: searchEAN.value }),
    search,
);

const headers = [
    { key: 'name', title: 'Name' },
    { key: 'quantity', title: 'Quantity', align: 'right' as const },
    { key: 'unitCost', title: 'Unit Cost', align: 'right' as const },
    { key: 'totalCost', title: 'Total Cost', align: 'right' as const },
];

/** A row of the restock's lines. Money formatted. */
interface RestockLineRow {
    id: string;
    name: string;
    quantity: number;
    unitCost: string;
    totalCost: string;
}

const serverItems = ref<RestockLineRow[]>([]);

const resetFilters = () => {
    searchEAN.value = '';
    searchName.value = '';
    applySearch();
};

const {
    loading,
    error: loadError,
    load: fetchDetails,
} = useListFetch(
    () =>
        api.get<Paginated<RestockLine>>(`/restocks/details/${props.item.id}`, {
            params: {
                page: page.value,
                limit: limit.value,
                name: applied.value.name?.toUpperCase(),
                EAN: applied.value.EAN,
            },
        }),
    (result) => {
        serverItems.value = result.data.data.map((details) => ({
            id: details._id,
            name: details.product.name,
            quantity: details.quantity,
            unitCost: formatCurrency(details.unitCost),
            totalCost: formatCurrency(details.unitCost * details.quantity),
        }));

        totalItems.value = result.data.totalItems;
    },
    'Could not load the details.',
);

onMounted(fetchDetails);
</script>
