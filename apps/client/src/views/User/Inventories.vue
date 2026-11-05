<template>
    <PageCard title="Inventory">
        <template #icon>
            <Package class="w-5 h-5 text-primary-600" />
        </template>
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
            <label class="flex items-center gap-2 text-sm"
                ><input
                    v-model="lowStock"
                    type="checkbox"
                    @change="toggleLowStock"
                />Low stock</label
            >
            <div class="flex items-end gap-2">
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
            empty-text="No inventory found"
            :items-length="totalItems"
            @retry="fetchInventory"
        />
    </PageCard>
    <InventoryBatches v-if="showBatches" />
</template>

<script setup lang="ts">
import InventoryBatches from '@/components/User/Inventory/InventoryBatches.vue';
import { formatQuantity, reorderLevelOf } from '@grocery-pos/contracts';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Package, Pencil, Search, X } from '@lucide/vue';
import api from '@/axios';
import { useAuthStore, Role } from '@/stores/auth';
import { useRestockPrefillStore } from '@/stores/restockPrefill';
import PageCard from '@/components/ui/PageCard.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import {
    useAppliedFilters,
    useListFetch,
    useListPaging,
} from '@/composables/useListFetch';
import type { InventoryRow, Paginated } from '@grocery-pos/contracts';

const router = useRouter();
const route = useRoute();
const showBatches = ref(route?.query.expiring === 'true');
const auth = useAuthStore();
const canRestock = computed(() => auth.isAdmin || auth.hasRole(Role.Restocker));
const prefill = useRestockPrefillStore();
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
    reorderLevel: string;
}

const serverItems = ref<InventoryListRow[]>([]);

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
