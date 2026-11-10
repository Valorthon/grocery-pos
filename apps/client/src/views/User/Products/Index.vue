<template>
    <PageFrame>
        <template #actions>
            <BaseButton
                v-if="canAddProducts"
                size="sm"
                @click="router.push({ name: 'Products/Add' })"
            >
                <Plus class="w-4 h-4" />
                Add Products
            </BaseButton>
        </template>
        <PageCard>
            <FilterBar
                v-model:search="searchName"
                search-label="Product Name"
                :active="filtersActive"
                class="px-5 py-4 border-b border-line"
                @search="onSearch"
                @clear="resetFilters"
            >
                <BaseInput
                    v-model="searchEAN"
                    label="EAN / Barcode"
                    clearable
                    @clear="applySearch"
                />
                <SegmentedFilter
                    :model-value="status"
                    :options="STATUS_FILTERS"
                    label="Status"
                    data-testid="status-filter"
                    @update:model-value="setStatus"
                />
                <BaseSelect
                    v-model="categoryFilter"
                    label="Category"
                    :options="
                        categories.map((row) => ({
                            value: row._id,
                            label:
                                row.name + (row.isActive ? '' : ' (archived)'),
                        }))
                    "
                    all-label="All categories"
                    @update:model-value="applySearch"
                />
            </FilterBar>
            <p
                v-if="categoryError"
                role="alert"
                class="px-5 py-3 text-sm text-red-700"
            >
                {{ categoryError }}
                <button
                    type="button"
                    class="min-h-11 underline"
                    @click="refreshCategories"
                >
                    Retry
                </button>
            </p>

            <BaseTable
                v-model:page="page"
                v-model:items-per-page="limit"
                :headers="headers"
                :items="serverItems"
                :loading="loading"
                :error="loadError"
                row-click
                empty-text="No products found"
                :items-length="totalItems"
                @click:row="openRow"
                @retry="fetchProducts"
            >
                <template #cell-name="{ item }"
                    ><ProductCell :name="item.name" :ean="item.EAN"
                /></template>
                <template #cell-status="{ item }"
                    ><StatusBadge
                        :status="
                            item.isActive === false ? 'archived' : 'active'
                        "
                        :map="PRODUCT_STATUS"
                        data-testid="product-status"
                /></template>
                <template #cell-price="{ item }">
                    <span class="font-medium">{{
                        formatCurrency(item.price) + '/' + unitLabel(item.unit)
                    }}</span>
                </template>
                <template #cell-cost="{ item }"
                    ><ProductCostSummary :product="item._id" :unit="item.unit"
                /></template>
                <template #cell-category="{ item }">{{
                    categories.find((row) => row._id === item.category)?.name ??
                    (item.category ? 'Unavailable category' : 'Uncategorized')
                }}</template>
                <template #cell-actions="{ item }">
                    <RowActions
                        :label="item.name"
                        :actions="rowActions(item)"
                    />
                </template>
            </BaseTable>
            <StockHistory
                v-if="history"
                :key="history._id"
                :product="history"
                @close="history = null"
            />
            <EditProductDialog
                v-if="editing"
                :product="editing"
                :model-value="true"
                @update:model-value="
                    (value) => {
                        if (!value) editing = null;
                    }
                "
                @saved="fetchProducts"
            />
            <ConfirmDialog :request="request" @answer="answer" />
        </PageCard>
    </PageFrame>
</template>

<script setup lang="ts">
import { useCategories } from '@/composables/useCategories';
import { findExactProduct, scannedTerm } from '@/composables/useBarcodeCapture';
import ProductCostSummary from '@/components/User/Product/ProductCostSummary.vue';
import { Role, unitLabel } from '@grocery-pos/contracts';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Plus } from '@lucide/vue';
import FilterBar from '@/components/ui/FilterBar.vue';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import PageFrame from '@/components/ui/PageFrame.vue';
import StockHistory from '@/components/User/Inventory/StockHistory.vue';
import EditProductDialog from '@/components/User/Product/EditProductDialog.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import SegmentedFilter from '@/components/ui/SegmentedFilter.vue';
import ProductCell from '@/components/ui/ProductCell.vue';
import StatusBadge from '@/components/ui/StatusBadge.vue';
import type { StatusMap } from '@/components/ui/status-badge';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import { useConfirm } from '@/composables/useConfirm';
import { useUIStore, Color } from '@/stores/ui';
import { apiErrorText } from '@/utils/api-error';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import RowActions from '@/components/ui/RowActions.vue';
import type { RowAction } from '@/components/ui/row-actions';
import { formatCurrency } from '@/utils/currency';
import type { Paginated, ProductView } from '@grocery-pos/contracts';
import { useAuthStore } from '@/stores/auth';
import { canOpenRoute, type RouteAccessMeta } from '@/router/access';
import {
    useAppliedFilters,
    useListFetch,
    useListPaging,
} from '@/composables/useListFetch';

const {
    categories,
    error: categoryError,
    refresh: refreshCategories,
} = useCategories();
const categoryFilter = ref<string | number | null>(null);
const router = useRouter();
const authStore = useAuthStore();
const history = ref<ProductView | null>(null);
// Offered only to whoever the router lets onto Products/Add (#83): an
// Adjuster can list products but not add them.
const canAddProducts = computed(() =>
    canOpenRoute(
        router.resolve({ name: 'Products/Add' }).meta as RouteAccessMeta,
        authStore.user?.roles ?? [],
    ),
);
const { page, limit, search } = useListPaging(() => fetchProducts());
const totalItems = ref(0);
const searchName = ref('');
const searchEAN = ref('');
type StatusFilter = 'active' | 'archived' | 'all';
const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
    { value: 'active', label: 'Active' },
    { value: 'archived', label: 'Archived' },
    { value: 'all', label: 'All' },
];
const status = ref<StatusFilter>('active');
function setStatus(value: StatusFilter) {
    status.value = value;
    applySearch();
}
const PRODUCT_STATUS: StatusMap<'active' | 'archived'> = {
    active: { label: 'Active', color: 'success' },
    archived: { label: 'Archived', color: 'neutral' },
};
const editing = ref<ProductListRow | null>(null);
const saving = ref(false);
const { request, confirm, answer } = useConfirm();
async function archive(item: ProductListRow) {
    if (saving.value) return;
    const restore = item.isActive === false;
    if (
        !(await confirm({
            title: restore ? 'Restore product?' : 'Archive product?',
            message: restore
                ? `Restore ${item.name} for sale?`
                : `Discontinue ${item.name}? Past records will be retained.`,
            confirmLabel: restore ? 'Restore' : 'Archive',
            danger: !restore,
        }))
    )
        return;
    saving.value = true;
    try {
        await api.patch('/products', {
            updates: [{ product: item._id, update: { isActive: restore } }],
        });
        await fetchProducts();
    } catch (cause) {
        useUIStore().queueMessage(Color.ERROR, apiErrorText(cause));
    } finally {
        saving.value = false;
    }
}

// What the list was last searched for: paging and Retry reuse it.
const { applied, apply: applySearch } = useAppliedFilters(
    () => ({
        name: searchName.value,
        EAN: searchEAN.value,
        status: status.value,
        category: categoryFilter.value,
    }),
    search,
);

/**
 * A scan (a barcode-shaped term + Enter) opens its one exact product,
 * archived too: Edit for product editors, else Stock history (#214).
 * Anything else, or no single exact match, is the normal search.
 */
async function onSearch() {
    const code = scannedTerm(searchName.value, searchEAN.value);
    if (code) {
        const found = await findExactProduct(code).catch(() => null);
        if (found) {
            const row = { ...found, id: found._id };
            if (canAddProducts.value) editing.value = row;
            else history.value = row;
            return;
        }
    }
    applySearch();
}

// Name first, then Category and Price (#172). The list API returns no
// stock, so Stock is not a column here (recorded on #172).
const headers = [
    // Name with its EAN below (#242).
    { key: 'name', title: 'Name', rowHeader: true },
    { key: 'category', title: 'Category' },
    { key: 'price', title: 'Price', align: 'right' as const },
    ...(authStore.user?.roles.includes(Role.Admin)
        ? [
              {
                  key: 'cost',
                  title: 'Latest cost / margin estimate',
                  align: 'right' as const,
              },
          ]
        : []),
    { key: 'status', title: 'Status' },
    { key: 'actions', title: 'Actions' },
];

/** A row opens Edit for product editors, else Stock history (#242, as #214). */
function openRow(item: ProductListRow) {
    if (canAddProducts.value) editing.value = item;
    else history.value = item;
}

/** History for everyone here; Edit and Archive/Restore as before (#83). */
function rowActions(item: ProductListRow): RowAction[] {
    return [
        { label: 'Stock history', onSelect: () => (history.value = item) },
        ...(canAddProducts.value
            ? [
                  { label: 'Edit', onSelect: () => (editing.value = item) },
                  {
                      label: item.isActive === false ? 'Restore' : 'Archive',
                      disabled: saving.value,
                      danger: item.isActive !== false,
                      onSelect: () => void archive(item),
                  },
              ]
            : []),
    ];
}

/** A row of the products table. */
interface ProductListRow extends ProductView {
    id: string;
}

const serverItems = ref<ProductListRow[]>([]);

/** Clear Filters is enabled while any filter is off its default (#215). */
const filtersActive = computed(
    () =>
        !!(
            searchName.value ||
            searchEAN.value ||
            status.value !== 'active' ||
            categoryFilter.value ||
            applied.value.name ||
            applied.value.EAN ||
            applied.value.status !== 'active' ||
            applied.value.category
        ),
);

const resetFilters = () => {
    searchEAN.value = '';
    status.value = 'active';
    categoryFilter.value = null;
    searchName.value = '';
    applySearch();
};

const {
    loading,
    error: loadError,
    load: fetchProducts,
} = useListFetch(
    () =>
        api.get<Paginated<ProductView>>(`/products`, {
            params: {
                page: page.value,
                limit: limit.value,
                name: applied.value.name?.toUpperCase(),
                EAN: applied.value.EAN,
                status: applied.value.status,
                ...(applied.value.category && {
                    category: applied.value.category,
                }),
            },
        }),
    (result) => {
        serverItems.value = result.data.data.map((product) => ({
            ...product,
            id: product._id,
            EAN: product.EAN,
            name: product.name,
            price: product.price,
            unit: product.unit,
        }));

        totalItems.value = result.data.totalItems;
    },
    'Could not load the products.',
);

void fetchProducts();
</script>
