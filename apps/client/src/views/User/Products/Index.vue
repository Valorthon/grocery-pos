<template>
    <PageCard title="Product List">
        <template #icon>
            <List class="w-5 h-5 text-primary-600" />
        </template>
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
                        label: row.name + (row.isActive ? '' : ' (archived)'),
                    }))
                "
                all-label="All categories"
                @update:model-value="applySearch"
            />
            <p v-if="categoryError" role="alert" class="text-sm text-red-700">
                {{ categoryError }}
                <button class="min-h-11 underline" @click="refreshCategories">
                    Retry
                </button>
            </p>
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
            empty-text="No products found"
            :items-length="totalItems"
            @retry="fetchProducts"
        >
            <template #cell-price="{ item }">
                <span class="font-medium">{{
                    formatCurrency(item.price) + '/' + unitLabel(item.unit)
                }}</span>
            </template>
            <template #cell-category="{ item }">{{
                categories.find((row) => row._id === item.category)?.name ??
                (item.category ? 'Unavailable category' : 'Uncategorized')
            }}</template>
            <template #cell-actions="{ item }">
                <div v-if="canAddProducts" class="flex gap-2">
                    <BaseButton size="sm" @click="editing = item"
                        >Edit</BaseButton
                    >
                    <BaseButton
                        size="sm"
                        variant="outline"
                        :disabled="saving"
                        @click="archive(item)"
                        >{{
                            item.isActive === false ? 'Restore' : 'Archive'
                        }}</BaseButton
                    >
                </div>
            </template>
        </BaseTable>
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
</template>

<script setup lang="ts">
import { useCategories } from '@/composables/useCategories';
import { unitLabel } from '@grocery-pos/contracts';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { List, Plus, Search, X } from '@lucide/vue';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import EditProductDialog from '@/components/User/Product/EditProductDialog.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import { useConfirm } from '@/composables/useConfirm';
import { useUIStore, Color } from '@/stores/ui';
import { apiErrorText } from '@/utils/api-error';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
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

const headers = [
    { key: 'EAN', title: 'EAN' },
    { key: 'name', title: 'Name' },
    { key: 'category', title: 'Category' },
    { key: 'price', title: 'Price', align: 'right' as const },
    { key: 'actions', title: 'Actions' },
];

/** A row of the products table. */
interface ProductListRow extends ProductView {
    id: string;
}

const serverItems = ref<ProductListRow[]>([]);

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
