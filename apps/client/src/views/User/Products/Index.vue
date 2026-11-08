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
                <BaseSelect
                    v-model="status"
                    label="Status"
                    :options="[
                        { value: 'active', label: 'Active' },
                        { value: 'archived', label: 'Archived' },
                        { value: 'all', label: 'All' },
                    ]"
                    @update:model-value="applySearch"
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
                <p
                    v-if="categoryError"
                    role="alert"
                    class="text-sm text-red-700"
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
                empty-text="No products found"
                :items-length="totalItems"
                @retry="fetchProducts"
            >
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
import ProductCostSummary from '@/components/User/Product/ProductCostSummary.vue';
import { Role, unitLabel } from '@grocery-pos/contracts';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Plus, X } from '@lucide/vue';
import FilterBar from '@/components/ui/FilterBar.vue';
import type { FilterChip } from '@/components/ui/page-primitives';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import PageFrame from '@/components/ui/PageFrame.vue';
import StockHistory from '@/components/User/Inventory/StockHistory.vue';
import EditProductDialog from '@/components/User/Product/EditProductDialog.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
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
const status = ref<string | number | null>('active');
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

// Name first, then Category and Price (#172). The list API returns no
// stock, so Stock is not a column here (recorded on #172).
const headers = [
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
    { key: 'EAN', title: 'EAN' },
    { key: 'actions', title: 'Actions' },
];

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

const STATUS_LABELS: Record<string, string> = {
    archived: 'Archived',
    all: 'All',
};
const chips = computed<FilterChip[]>(() => {
    const a = applied.value;
    const out: FilterChip[] = [];
    if (a.name) out.push({ key: 'name', label: `Name: ${a.name}` });
    if (a.EAN) out.push({ key: 'EAN', label: `EAN: ${a.EAN}`, inPanel: true });
    if (a.status && a.status !== 'active')
        out.push({
            key: 'status',
            label: `Status: ${STATUS_LABELS[String(a.status)] ?? a.status}`,
            inPanel: true,
        });
    if (a.category)
        out.push({
            key: 'category',
            label: `Category: ${categories.value.find((row) => row._id === a.category)?.name ?? a.category}`,
            inPanel: true,
        });
    return out;
});
/** Drops one applied filter; typed-but-unsearched text goes back first. */
function removeFilter(key: string) {
    searchName.value = key === 'name' ? '' : applied.value.name;
    searchEAN.value = key === 'EAN' ? '' : applied.value.EAN;
    if (key === 'status') status.value = 'active';
    if (key === 'category') categoryFilter.value = null;
    applySearch();
}

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
