<template>
    <div>
        <div class="px-5 py-4 border-b border-slate-100">
            <div class="flex items-start justify-between gap-4">
                <h3
                    class="min-w-0 break-words text-base font-bold"
                    data-testid="details-heading"
                >
                    <button
                        v-if="countId && canOpenCounts"
                        type="button"
                        class="min-h-11 text-leaf-700 underline"
                        data-testid="stock-count-link"
                        @click="openCount(countId)"
                    >
                        {{ heading }}
                    </button>
                    <template v-else>{{ heading }}</template>
                </h3>
                <div
                    v-if="lineCount !== null"
                    class="shrink-0 text-base font-bold"
                    data-testid="details-line-count"
                >
                    {{ countOf(lineCount, 'line') }}
                </div>
            </div>
            <ul
                class="mt-1 flex flex-wrap items-center text-sm text-muted"
                data-testid="details-meta"
            >
                <li v-if="item.adjustedBy" :class="[META_ITEM, 'capitalize']">
                    {{ item.adjustedBy }}
                </li>
                <li v-if="item.date" :class="META_ITEM">{{ item.date }}</li>
            </ul>
        </div>

        <div class="px-5 py-3 bg-slate-50 border-b border-slate-200">
            <FilterBar
                v-model:search="searchTerm"
                compact
                search-label="Search name or barcode"
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
import { formatQuantity } from '@grocery-pos/contracts';
import { Role } from '@grocery-pos/contracts';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '@/axios';
import BaseTable from '@/components/ui/BaseTable.vue';
import ProductCell from '@/components/ui/ProductCell.vue';
import FilterBar from '@/components/ui/FilterBar.vue';
import { META_ITEM } from '@/components/User/details-meta';
import { useAuthStore } from '@/stores/auth';
import { countOf } from '@/utils/plural';
import { productSearchParams } from '@/utils/product-search';
import { stockCountId, stockCountLabel } from './stock-count-ref';
import {
    useAppliedFilters,
    useListFetch,
    useListPaging,
} from '@/composables/useListFetch';
import type { AdjustmentLine, Paginated } from '@grocery-pos/contracts';
import type { AdjustmentListRow } from './rows';

const props = defineProps<{
    item: AdjustmentListRow;
}>();

const { page, limit, search } = useListPaging(() => fetchDetails());
const totalItems = ref(0);
const searchTerm = ref('');
// What the list was last searched for: paging and Retry reuse it.
const { applied, apply: applySearch } = useAppliedFilters(
    () => searchTerm.value.trim(),
    search,
);
/** All the adjustment's lines: the total of an unsearched load. */
const lineCount = ref<number | null>(null);

// A count approval's adjustment (#43) reads "Stock count 1A2B3C4D" and
// links to the count for those who may open Stock counts (#260).
const countId = computed(() => stockCountId(props.item.description));
const heading = computed(() => stockCountLabel(props.item.description));
const router = useRouter();
const authStore = useAuthStore();
const canOpenCounts = computed(
    () => authStore.hasRole(Role.Admin) || authStore.hasRole(Role.Adjuster),
);
function openCount(id: string) {
    void router.push({ name: 'StockCounts', query: { source: id } });
}

const headers = [
    { key: 'name', title: 'Product', rowHeader: true },
    { key: 'change', title: 'Change', align: 'right' as const },
    { key: 'reason', title: 'Reason' },
];

/** A row of the adjustment's lines. */
interface AdjustmentLineRow {
    id: string;
    name: string;
    EAN: string;
    change: string;
    reason: string;
}

const serverItems = ref<AdjustmentLineRow[]>([]);

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
        api.get<Paginated<AdjustmentLine>>(
            `/adjustments/details/${props.item.id}`,
            {
                params: {
                    page: page.value,
                    limit: limit.value,
                    ...productSearchParams(applied.value),
                },
            },
        ),
    (result) => {
        serverItems.value = result.data.data.map((details) => ({
            id: details._id,
            name: details.product.name,
            EAN: details.product.EAN,
            change: formatQuantity(details.change, details.product.unit),
            reason: stockCountLabel(details.reason),
        }));

        totalItems.value = result.data.totalItems;
        if (!applied.value) lineCount.value = result.data.totalItems;
    },
    'Could not load the details.',
);

onMounted(fetchDetails);
</script>
