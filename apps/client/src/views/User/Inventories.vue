<template>
    <PageFrame>
        <template #actions>
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
                v-model:search="searchTerm"
                search-label="Search name or barcode"
                :active="filtersActive"
                class="px-5 py-4 border-b border-line"
                @search="onSearch"
                @clear="resetFilters"
            >
                <div
                    role="group"
                    aria-label="Stock status"
                    class="flex self-end rounded-control border border-line overflow-hidden"
                    data-testid="stock-filter"
                >
                    <button
                        v-for="option in STOCK_FILTERS"
                        :key="option.value"
                        type="button"
                        :aria-pressed="stockFilter === option.value"
                        :data-value="option.value"
                        :class="[
                            'focus-ring min-h-11 flex-1 px-3 text-sm font-semibold whitespace-nowrap border-l border-line first:border-l-0',
                            stockFilter === option.value
                                ? 'bg-leaf-600 text-white'
                                : 'bg-surface text-ink hover:bg-paper',
                        ]"
                        @click="setStockFilter(option.value)"
                    >
                        {{ option.label }}
                    </button>
                </div>
            </FilterBar>
            <p
                v-if="route?.query.expiring === 'true'"
                class="px-5 py-2 text-sm text-muted"
                data-testid="deep-link-note"
            >
                Showing batches expiring within
                {{ settingsStore.settings.expiryAlertDays }} days
            </p>
            <div ref="tableHost" @keydown="onRowKeydown">
                <BaseTable
                    v-model:page="page"
                    v-model:items-per-page="limit"
                    :headers="headers"
                    :items="serverItems"
                    :loading="loading"
                    :error="loadError"
                    row-click
                    empty-text="No inventory found"
                    :items-length="totalItems"
                    @click:row="openHistory"
                    @retry="fetchInventory"
                >
                    <template #cell-name="{ item }"
                        ><span class="block">{{ item.name }}</span
                        ><span
                            class="block text-xs text-muted font-normal num"
                            data-testid="row-ean"
                            >{{ item.EAN }}</span
                        ></template
                    >
                    <template #cell-stock="{ item }"
                        ><span class="block">{{ item.stock }}</span
                        ><span class="mt-1 block sm:hidden"
                            ><Badge :color="STATUS[item.status].color">{{
                                STATUS[item.status].label
                            }}</Badge></span
                        ></template
                    >
                    <template #cell-reorderLevel="{ item }"
                        ><span class="text-muted">{{
                            item.reorderLevel
                        }}</span></template
                    >
                    <template #cell-status="{ item }"
                        ><Badge
                            :color="STATUS[item.status].color"
                            data-testid="stock-status"
                            >{{ STATUS[item.status].label }}</Badge
                        ></template
                    >
                    <template #cell-history="{ item }"
                        ><BaseButton
                            size="sm"
                            variant="ghost"
                            class="-my-2 min-h-11 min-w-11 w-11 h-11 p-0"
                            :aria-label="`Stock history for ${item.name}`"
                            data-testid="stock-history-button"
                            @click.stop="openHistory(item)"
                            ><History class="w-5 h-5" aria-hidden="true"
                        /></BaseButton>
                    </template>
                </BaseTable>
            </div>
        </PageCard>
    </PageFrame>
    <!-- Always shown (#233); the dashboard's expiring link scrolls to it. -->
    <InventoryBatches :focus-on-load="route?.query.expiring === 'true'" />
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
import { findExactProduct, scannedTerm } from '@/composables/useBarcodeCapture';
import type { ProductView, UnitOfMeasure } from '@grocery-pos/contracts';
import InventoryBatches from '@/components/User/Inventory/InventoryBatches.vue';
import { formatQuantity, reorderLevelOf } from '@grocery-pos/contracts';
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { History, Pencil } from '@lucide/vue';
import Badge from '@/components/ui/Badge.vue';
import { useSettingsStore } from '@/stores/settings';
import FilterBar from '@/components/ui/FilterBar.vue';
import api from '@/axios';
import { useAuthStore, Role } from '@/stores/auth';
import { canOpenRoute, type RouteAccessMeta } from '@/router/access';
import { useRestockPrefillStore } from '@/stores/restockPrefill';
import { usePurchaseOrderPrefillStore } from '@/stores/purchaseOrderPrefill';
import PageCard from '@/components/ui/PageCard.vue';
import PageFrame from '@/components/ui/PageFrame.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
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
const settingsStore = useSettingsStore();
const auth = useAuthStore();
const canRestock = computed(() => auth.isAdmin || auth.hasRole(Role.Restocker));
const prefill = useRestockPrefillStore();
const poPrefill = usePurchaseOrderPrefillStore();
const lowStock = ref(route?.query.lowStock === 'true');
// Low stock and out of stock are exclusive (#212); low stock wins a URL with both.
const outOfStock = ref(!lowStock.value && route?.query.outOfStock === 'true');
type StockFilter = 'all' | 'low' | 'out';
const STOCK_FILTERS: { value: StockFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'low', label: 'Low stock' },
    { value: 'out', label: 'Out of stock' },
];
/** The segmented control's value (#232), over the two query flags. */
const stockFilter = computed<StockFilter>(() =>
    lowStock.value ? 'low' : outOfStock.value ? 'out' : 'all',
);
function setStockFilter(value: StockFilter) {
    if (value === stockFilter.value) return;
    lowStock.value = value === 'low';
    outOfStock.value = value === 'out';
    syncStockQuery();
}
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
const { page, limit, search } = useListPaging(() => fetchInventory(), 25);
const totalItems = ref(0);
const searchTerm = ref('');
// An unknown barcode-shaped term searches barcodes; any other, names.
const searchEAN = ref('');
// What the list was last searched for: paging and Retry reuse it.
const { applied, apply: applySearch } = useAppliedFilters(
    () => ({
        name: searchEAN.value ? '' : searchTerm.value.trim(),
        EAN: searchEAN.value,
        lowStock: lowStock.value,
        outOfStock: outOfStock.value,
    }),
    search,
);

/**
 * A scan (a barcode-shaped term + Enter) opens its one exact product's
 * Stock history, archived too (#214); otherwise the normal search.
 */
async function onSearch() {
    const code = scannedTerm(searchTerm.value);
    searchEAN.value = '';
    if (code) {
        const found = await findExactProduct(code).catch(() => null);
        if (found) {
            history.value = {
                _id: found._id,
                name: found.name,
                unit: found.unit,
                EAN: found.EAN,
                reorderLevel: formatQuantity(reorderLevelOf(found), found.unit),
            };
            return;
        }
        searchEAN.value = code;
    }
    applySearch();
}

const headers = [
    { key: 'name', title: 'Product', rowHeader: true },
    { key: 'stock', title: 'Stock', align: 'right' as const },
    {
        key: 'reorderLevel',
        title: 'Reorder at',
        align: 'right' as const,
        // Hidden below md (#210); the Stock history dialog shows it.
        hideBelow: 'md' as const,
    },
    // Below sm the badge sits under the stock figure instead.
    { key: 'status', title: 'Status', hideBelow: 'sm' as const },
    { key: 'history', title: 'History' },
];

/** The #40 / dashboard predicate: out at ≤ 0, low at ≤ the reorder level. */
type StockStatus = 'out' | 'low' | 'ok';
function stockStatus(stock: number, reorderLevel: number): StockStatus {
    if (stock <= 0) return 'out';
    return stock <= reorderLevel ? 'low' : 'ok';
}
const STATUS: Record<
    StockStatus,
    { label: string; color: 'error' | 'warning' | 'success' }
> = {
    out: { label: 'Out of stock', color: 'error' },
    low: { label: 'Low stock', color: 'warning' },
    ok: { label: 'In stock', color: 'success' },
};

/** A row of the inventory table. */
interface InventoryListRow {
    /** The product's id. */
    id: string;
    EAN: string;
    name: string;
    stock: string;
    status: StockStatus;
    unit?: UnitOfMeasure;
    reorderLevel: string;
}

function openHistory(item: InventoryListRow) {
    history.value = {
        _id: item.id,
        name: item.name,
        unit: item.unit,
        EAN: item.EAN,
        reorderLevel: item.reorderLevel,
    };
}

const serverItems = ref<InventoryListRow[]>([]);

/** Clear Filters is enabled while any filter or deep link is set (#215). */
const filtersActive = computed(
    () =>
        !!(
            searchTerm.value ||
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
    searchTerm.value = '';
    lowStock.value = false;
    outOfStock.value = false;
    // The `?expiring=` deep link (dashboard) is cleared too; the panel stays.
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
            status: stockStatus(
                inventory.stock,
                reorderLevelOf(inventory.product),
            ),
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

/*
 * Keyboard row activation (#232), page-local until #234 moves it into
 * BaseTable: each body row is focusable, Enter/Space opens its history.
 */
const tableHost = ref<HTMLElement | null>(null);
function bodyRows(): HTMLTableRowElement[] {
    return [
        ...(tableHost.value?.querySelectorAll<HTMLTableRowElement>(
            'tbody tr',
        ) ?? []),
    ];
}
watch(
    () => [serverItems.value, loading.value, loadError.value],
    async () => {
        await nextTick();
        const live = !loading.value && !loadError.value;
        for (const row of bodyRows()) {
            if (live && serverItems.value.length) {
                row.tabIndex = 0;
                row.classList.add('focus-ring');
            } else row.removeAttribute('tabindex');
        }
    },
    { flush: 'post' },
);
function onRowKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.repeat) return;
    const row = event.target as HTMLElement;
    if (row.tagName !== 'TR') return;
    const item =
        serverItems.value[bodyRows().indexOf(row as HTMLTableRowElement)];
    if (!item) return;
    event.preventDefault();
    openHistory(item);
}

void fetchInventory();
</script>
