<template>
    <div>
        <div class="px-5 py-4 border-b border-slate-100">
            <div class="flex items-start justify-between gap-4">
                <h3
                    v-if="item.supplier"
                    class="min-w-0 break-words text-base font-bold"
                    data-testid="details-heading"
                >
                    {{ item.supplier }}
                </h3>
                <h3
                    v-else
                    class="min-w-0 text-base font-medium text-muted"
                    data-testid="details-heading"
                >
                    Unknown supplier
                </h3>
                <div
                    class="shrink-0 text-base font-bold text-leaf-600"
                    data-testid="details-total"
                >
                    {{ item.totalCost }}
                </div>
            </div>
            <ul
                class="mt-1 flex flex-wrap items-center text-sm text-muted"
                data-testid="details-meta"
            >
                <li v-if="item.invoiceNumber" :class="META_ITEM">
                    {{ item.invoiceNumber }}
                </li>
                <li
                    v-if="item.purchaseOrder"
                    :class="META_ITEM"
                    data-testid="restock-purchase-order"
                >
                    <PurchaseOrderLink :purchase-order="item.purchaseOrder" />
                </li>
                <li v-if="item.restockedBy" :class="[META_ITEM, 'capitalize']">
                    {{ item.restockedBy }}
                </li>
                <li v-if="item.date" :class="META_ITEM">{{ item.date }}</li>
            </ul>
            <p
                v-if="showDescription"
                class="mt-1 text-sm"
                data-testid="details-description"
            >
                {{ item.description }}
            </p>
        </div>

        <div class="px-5 py-3 bg-slate-50 border-b border-slate-200">
            <FilterBar
                v-model:search="searchTerm"
                compact
                search-label="Search name or barcode"
                :maxlength="STRING_LIMITS.PRODUCT_NAME"
                :active="!!searchTerm.trim() || !!applied"
                @search="applySearch"
                @clear="resetFilters"
            />
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
        >
            <template #cell-name="{ item: line }"
                ><ProductCell :name="line.name" :ean="line.EAN"
            /></template>
        </BaseTable>
    </div>
</template>

<script setup lang="ts">
import {
    formatQuantity,
    purchaseOrderReference,
    quantityAmount,
} from '@grocery-pos/contracts';
import { computed, onMounted, ref } from 'vue';
import api from '@/axios';
import PurchaseOrderLink from './PurchaseOrderLink.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import ProductCell from '@/components/ui/ProductCell.vue';
import { STRING_LIMITS } from '@grocery-pos/contracts';
import FilterBar from '@/components/ui/FilterBar.vue';
import { META_ITEM } from '@/components/User/details-meta';
import {
    useAppliedFilters,
    useListFetch,
    useListPaging,
} from '@/composables/useListFetch';
import { formatCurrency } from '@/utils/currency';
import { productSearchParams } from '@/utils/product-search';
import type { Paginated, RestockLine } from '@grocery-pos/contracts';
import type { RestockListRow } from './rows';

const props = defineProps<{
    item: RestockListRow;
}>();

const { page, limit, search } = useListPaging(() => fetchDetails());
const totalItems = ref(0);
const searchTerm = ref('');
// What the list was last searched for: paging and Retry reuse it.
const { applied, apply: applySearch } = useAppliedFilters(
    () => searchTerm.value.trim(),
    search,
);

// A receipt against a PO is described as the PO by default (#123); that
// repeats the meta line, so only a description of its own shows (#260).
const showDescription = computed(() => {
    const { description, purchaseOrder } = props.item;
    if (!description) return false;
    return (
        !purchaseOrder ||
        description !==
            `Purchase order ${purchaseOrderReference(purchaseOrder)}`
    );
});

const headers = [
    { key: 'name', title: 'Product', rowHeader: true },
    { key: 'quantity', title: 'Quantity', align: 'right' as const },
    { key: 'unitCost', title: 'Unit Cost', align: 'right' as const },
    { key: 'totalCost', title: 'Total Cost', align: 'right' as const },
];

/** A row of the restock's lines. Money formatted. */
interface RestockLineRow {
    id: string;
    name: string;
    EAN: string;
    quantity: string;
    unitCost: string;
    totalCost: string;
}

const serverItems = ref<RestockLineRow[]>([]);

const resetFilters = () => {
    searchTerm.value = '';
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
                ...productSearchParams(applied.value),
            },
        }),
    (result) => {
        serverItems.value = result.data.data.map((details) => ({
            id: details._id,
            name: details.product.name,
            EAN: details.product.EAN,
            quantity: formatQuantity(
                details.quantity,
                details.unit ?? details.product.unit,
            ),
            unitCost: formatCurrency(details.unitCost),
            totalCost: formatCurrency(
                quantityAmount(
                    details.unitCost,
                    details.quantity,
                    details.unit ?? details.product.unit,
                ),
            ),
        }));

        totalItems.value = result.data.totalItems;
    },
    'Could not load the details.',
);

onMounted(fetchDetails);
</script>
