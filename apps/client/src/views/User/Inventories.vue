<template>
    <PageFrame>
        <template #actions>
            <BaseButton
                size="sm"
                variant="outline"
                @click="showBatches = !showBatches"
                >{{
                    showBatches ? 'Hide batches' : 'Expiry and batches'
                }}</BaseButton
            >
            <BaseButton
                v-if="canRestock && (applied.lowStock || applied.outOfStock)"
                size="sm"
                :disabled="loading || !!loadError || sourceRows.length === 0"
                @click="createRestock"
                >Restock listed items</BaseButton
            >
            <BaseButton
                v-if="canRestock && (applied.lowStock || applied.outOfStock)"
                size="sm"
                variant="outline"
                :disabled="loading || !!loadError || sourceRows.length === 0"
                @click="createPurchaseOrder"
                >Create purchase order</BaseButton
            >
            <BaseButton
                v-if="canAdjust"
                size="sm"
                @click="router.push({ name: 'Adjustments/Add' })"
            >
                <Pencil class="w-4 h-4" />
                Adjust
            </BaseButton>
        </template>
        <PageCard>
            <FilterBar
                v-model:search="searchName"
                search-label="Product Name"
                :active="filtersActive"
                class="px-5 py-4 border-b border-line"
                @search="applySearch"
                @clear="resetFilters"
            >
                <BaseInput
                    v-model="searchEAN"
                    label="EAN / Barcode"
                    clearable
                    @clear="applySearch"
                />
                <label
                    class="flex min-h-11 items-center gap-2 self-end text-sm"
                    data-testid="low-stock-filter"
                    ><input
                        v-model="lowStock"
                        type="checkbox"
                        @change="toggleLowStock"
                    />Low stock</label
                >
                <label
                    class="flex min-h-11 items-center gap-2 self-end text-sm"
                    data-testid="out-of-stock-filter"
                    ><input
                        v-model="outOfStock"
                        type="checkbox"
                        @change="toggleOutOfStock"
                    />Out of stock</label
                >
            </FilterBar>
            <BaseTable
                v-model:page="page"
                v-model:items-per-page="limit"
                :headers="headers"
                :items="serverItems"
                :loading="loading"
                :error="loadError"
                empty-text="No inventory found"
                :items-length="totalItems"
                @retry="fetchInventory"
            >
                <template #cell-history="{ item }"
                    ><BaseButton
                        size="sm"
                        variant="outline"
                        class="min-h-11 min-w-11"
                        :aria-label="`Stock history for ${item.name}`"
                        data-testid="stock-history-button"
                        @click="
                            history = {
                                _id: item.id,
                                name: item.name,
                                unit: item.unit,
                                EAN: item.EAN,
                                reorderLevel: item.reorderLevel,
                            }
                        "
                        ><span class="sm:hidden">History</span
                        ><span class="hidden sm:inline"
                            >Stock history</span
                        ></BaseButton
                    ></template
                >
            </BaseTable>
        </PageCard>
    </PageFrame>
    <InventoryBatches v-if="showBatches" />
    <StockHistory
        v-if="history"
        :key="history._id"
        :product="history"
        :ean="history.EAN"
        :reorder-level="history.reorderLevel"
        @close="history = null"
    />
</template>

<script setup lang="ts">
import StockHistory from '@/components/User/Inventory/StockHistory.vue';
import type { ProductView, UnitOfMeasure } from '@grocery-pos/contracts';
import InventoryBatches from '@/components/User/Inventory/InventoryBatches.vue';
import { formatQuantity, reorderLevelOf } from '@grocery-pos/contracts';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Pencil } from '@lucide/vue';
import FilterBar from '@/components/ui/FilterBar.vue';
import api from '@/axios';
import { useAuthStore, Role } from '@/stores/auth';
import { canOpenRoute, type RouteAccessMeta } from '@/router/access';
import { useRestockPrefillStore } from '@/stores/restockPrefill';
import { usePurchaseOrderPrefillStore } from '@/stores/purchaseOrderPrefill';
import PageCard from '@/components/ui/PageCard.vue';
import PageFrame from '@/components/ui/PageFrame.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import {
    useAppliedFilters,
    useListFetch,
    useListPaging,
} from '@/composables/useListFetch';
import type { InventoryRow, Paginated } from '@grocery-pos/contracts';

const history = ref<
    | (Pick<ProductView, '_id' | 'name' | 'unit'> & {
          EAN: string;
          reorderLevel: string;
      })
    | null
>(null);
const router = useRouter();
// Offered only to whoever the router lets onto Adjustments/Add (#206): a
// Restocker can list inventory but not adjust it.
const canAdjust = computed(() =>
    canOpenRoute(
        router.resolve({ name: 'Adjustments/Add' }).meta as RouteAccessMeta,
        useAuthStore().user?.roles ?? [],
    ),
);
const route = useRoute();
const showBatches = ref(route?.query.expiring === 'true');
const auth = useAuthStore();
const canRestock = computed(() => auth.isAdmin || auth.hasRole(Role.Restocker));
const prefill = useRestockPrefillStore();
const poPrefill = usePurchaseOrderPrefillStore();
const lowStock = ref(route?.query.lowStock === 'true');
// Low stock and out of stock are exclusive (#212); low stock wins a URL with both.
const outOfStock = ref(!lowStock.value && route?.query.outOfStock === 'true');
const sourceRows = ref<InventoryRow[]>([]);
async function createRestock() {
    if (
        !canRestock.value ||
        !sourceRows.value.length ||
        loadError.value ||
        loading.value
    )
        return;
    if (prefill.prepare(sourceRows.value))
        await router.push({ name: 'Restocks/Add' });
}
async function createPurchaseOrder() {
    if (
        !canRestock.value ||
        !sourceRows.value.length ||
        loadError.value ||
        loading.value
    )
        return;
    if (poPrefill.prepare(sourceRows.value))
        await router.push({ name: 'PurchaseOrders' });
}
/** Applies the stock filters and mirrors them in the URL. */
function syncStockQuery() {
    applySearch();
    void router.replace({
        query: {
            ...route?.query,
            lowStock: lowStock.value ? 'true' : undefined,
            outOfStock: outOfStock.value ? 'true' : undefined,
        },
    });
}
function toggleLowStock() {
    if (lowStock.value) outOfStock.value = false;
    syncStockQuery();
}
function toggleOutOfStock() {
    if (outOfStock.value) lowStock.value = false;
    syncStockQuery();
}
watch(
    () => [route?.query.lowStock, route?.query.outOfStock],
    ([low, out]) => {
        const nextLow = low === 'true';
        const nextOut = !nextLow && out === 'true';
        if (lowStock.value !== nextLow || outOfStock.value !== nextOut) {
            lowStock.value = nextLow;
            outOfStock.value = nextOut;
            applySearch();
        }
    },
);
const { page, limit, search } = useListPaging(() => fetchInventory());
const totalItems = ref(0);
const searchName = ref('');
const searchEAN = ref('');
// What the list was last searched for: paging and Retry reuse it.
const { applied, apply: applySearch } = useAppliedFilters(
    () => ({
        name: searchName.value,
        EAN: searchEAN.value,
        lowStock: lowStock.value,
        outOfStock: outOfStock.value,
    }),
    search,
);

const headers = [
    { key: 'history', title: 'History' },
    // Hidden at phone width (#210); the Stock history dialog shows both.
    { key: 'EAN', title: 'EAN', hideBelow: 'sm' as const },
    { key: 'name', title: 'Name' },
    { key: 'stock', title: 'Stock', align: 'right' as const },
    {
        key: 'reorderLevel',
        title: 'Reorder level',
        align: 'right' as const,
        hideBelow: 'md' as const,
    },
];

/** A row of the inventory table. */
interface InventoryListRow {
    /** The product's id. */
    id: string;
    EAN: string;
    name: string;
    stock: string;
    unit?: UnitOfMeasure;
    reorderLevel: string;
}

const serverItems = ref<InventoryListRow[]>([]);

/** Clear Filters is enabled while any filter or deep link is set (#215). */
const filtersActive = computed(
    () =>
        !!(
            searchName.value ||
            searchEAN.value ||
            lowStock.value ||
            outOfStock.value ||
            applied.value.name ||
            applied.value.EAN ||
            applied.value.lowStock ||
            applied.value.outOfStock ||
            route?.query.expiring === 'true'
        ),
);

const resetFilters = () => {
    searchEAN.value = '';
    searchName.value = '';
    lowStock.value = false;
    outOfStock.value = false;
    // The `?expiring=` deep link (dashboard) is cleared too, with its panel.
    if (route?.query.expiring === 'true') showBatches.value = false;
    applySearch();
    void router.replace({
        query: {
            ...route?.query,
            lowStock: undefined,
            outOfStock: undefined,
            expiring: undefined,
        },
    });
};

const {
    loading,
    error: loadError,
    load: fetchInventory,
} = useListFetch(
    () =>
        api.get<Paginated<InventoryRow>>(`/inventories`, {
            params: {
                page: page.value,
                limit: limit.value,
                name: applied.value.name?.toUpperCase(),
                EAN: applied.value.EAN,
                lowStock: applied.value.lowStock || undefined,
                outOfStock: applied.value.outOfStock || undefined,
            },
        }),
    (result) => {
        sourceRows.value = result.data.data;
        const data = result.data.data.map((inventory) => ({
            id: inventory.product._id,
            unit: inventory.product.unit,
            EAN: inventory.product.EAN,
            name: inventory.product.name,
            stock: formatQuantity(inventory.stock, inventory.product.unit),
            reorderLevel: formatQuantity(
                reorderLevelOf(inventory.product),
                inventory.product.unit,
            ),
        }));

        serverItems.value = data;
        totalItems.value = result.data.totalItems;
    },
    'Could not load the inventory.',
);

void fetchInventory();
</script>
