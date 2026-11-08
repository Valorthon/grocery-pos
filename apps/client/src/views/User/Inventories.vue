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
                v-if="canRestock && applied.lowStock"
                size="sm"
                :disabled="loading || !!loadError || sourceRows.length === 0"
                @click="createRestock"
                >Restock listed items</BaseButton
            >
            <BaseButton
                v-if="canRestock && applied.lowStock"
                size="sm"
                variant="outline"
                :disabled="loading || !!loadError || sourceRows.length === 0"
                @click="createPurchaseOrder"
                >Create purchase order</BaseButton
            >
            <BaseButton
                size="sm"
                @click="router.push({ name: 'Adjustments/Add' })"
            >
                <Pencil class="w-4 h-4" />
                Adjust
            </BaseButton>
        </template>
        <template v-if="applied.lowStock" #chips>
            <Badge color="warning" size="md" data-testid="low-stock-chip"
                >Filtered: low stock</Badge
            >
        </template>
        <PageCard>
            <FilterBar
                v-model:search="searchName"
                search-label="Product Name"
                :chips="chips"
                :initially-open="chips.some((chip) => chip.inPanel)"
                class="px-5 py-4 border-b border-line"
                @search="applySearch"
                @remove="removeFilter"
                @clear="resetFilters"
            >
                <BaseInput
                    v-model="searchEAN"
                    label="EAN / Barcode"
                    clearable
                    @clear="applySearch"
                />
                <label class="flex min-h-11 items-center gap-2 text-sm"
                    ><input
                        v-model="lowStock"
                        type="checkbox"
                        @change="toggleLowStock"
                    />Low stock</label
                >
                <div class="flex items-end">
                    <BaseButton
                        variant="outline"
                        class="min-h-11"
                        @click="resetFilters"
                    >
                        <X class="w-4 h-4" />
                        Clear Filters
                    </BaseButton>
                </div>
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
                        @click="
                            history = {
                                _id: item.id,
                                name: item.name,
                                unit: item.unit,
                            }
                        "
                        >Stock history</BaseButton
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
import { Pencil, X } from '@lucide/vue';
import FilterBar from '@/components/ui/FilterBar.vue';
import type { FilterChip } from '@/components/ui/page-primitives';
import api from '@/axios';
import { useAuthStore, Role } from '@/stores/auth';
import { useRestockPrefillStore } from '@/stores/restockPrefill';
import { usePurchaseOrderPrefillStore } from '@/stores/purchaseOrderPrefill';
import PageCard from '@/components/ui/PageCard.vue';
import PageFrame from '@/components/ui/PageFrame.vue';
import Badge from '@/components/ui/Badge.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import {
    useAppliedFilters,
    useListFetch,
    useListPaging,
} from '@/composables/useListFetch';
import type { InventoryRow, Paginated } from '@grocery-pos/contracts';

const history = ref<Pick<ProductView, '_id' | 'name' | 'unit'> | null>(null);
const router = useRouter();
const route = useRoute();
const showBatches = ref(route?.query.expiring === 'true');
const auth = useAuthStore();
const canRestock = computed(() => auth.isAdmin || auth.hasRole(Role.Restocker));
const prefill = useRestockPrefillStore();
const poPrefill = usePurchaseOrderPrefillStore();
const lowStock = ref(route?.query.lowStock === 'true');
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
function toggleLowStock() {
    applySearch();
    void router.replace({
        query: {
            ...route?.query,
            lowStock: lowStock.value ? 'true' : undefined,
        },
    });
}
watch(
    () => route?.query.lowStock,
    (value) => {
        const next = value === 'true';
        if (lowStock.value !== next) {
            lowStock.value = next;
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
    }),
    search,
);

const headers = [
    { key: 'history', title: 'History' },
    { key: 'EAN', title: 'EAN' },
    { key: 'name', title: 'Name' },
    { key: 'stock', title: 'Stock', align: 'right' as const },
    { key: 'reorderLevel', title: 'Reorder level', align: 'right' as const },
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

const chips = computed<FilterChip[]>(() => {
    const a = applied.value;
    const out: FilterChip[] = [];
    if (a.name) out.push({ key: 'name', label: `Name: ${a.name}` });
    if (a.EAN) out.push({ key: 'EAN', label: `EAN: ${a.EAN}`, inPanel: true });
    if (a.lowStock)
        out.push({ key: 'lowStock', label: 'Low stock', inPanel: true });
    return out;
});
/** Drops one applied filter; typed-but-unsearched text goes back first. */
function removeFilter(key: string) {
    searchName.value = key === 'name' ? '' : applied.value.name;
    searchEAN.value = key === 'EAN' ? '' : applied.value.EAN;
    if (key === 'lowStock') {
        lowStock.value = false;
        toggleLowStock();
    } else applySearch();
}

const resetFilters = () => {
    searchEAN.value = '';
    searchName.value = '';
    lowStock.value = false;
    toggleLowStock();
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
