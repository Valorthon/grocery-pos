<template>
    <PageFrame>
        <template #actions>
            <BaseButton
                size="sm"
                @click="router.push({ name: 'Restocks/Add' })"
            >
                <Truck class="w-4 h-4" />
                Restock
            </BaseButton>
        </template>
        <PageCard>
            <FilterBar
                :searchable="false"
                :chips="chips"
                initially-open
                class="px-5 py-4 border-b border-line"
                @remove="removeFilter"
                @clear="resetFilters"
            >
                <BaseSelect
                    v-model="searchRestockedBy"
                    :options="userOptions"
                    label="Restocked By"
                    all-label="All users"
                    @update:model-value="applyFilters"
                />
                <BaseInput
                    v-model="searchDateStart"
                    label="From"
                    type="date"
                    :max="searchDateEnd || undefined"
                    @update:model-value="applyFilters"
                />
                <BaseInput
                    v-model="searchDateEnd"
                    label="To"
                    type="date"
                    :min="searchDateStart || undefined"
                    :error="rangeError"
                    @update:model-value="applyFilters"
                />
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
                empty-text="No restocks found"
                :items-length="totalItems"
                row-click
                @click:row="showDetails"
                @retry="fetchRestock"
            >
                <template #cell-purchaseOrder="{ item }">
                    <PurchaseOrderLink :purchase-order="item.purchaseOrder" />
                </template>
            </BaseTable>
        </PageCard>
    </PageFrame>

    <BaseModal
        v-model="isDialogOpen"
        title="Restock Details"
        max-width="52rem"
        scrollable
    >
        <RestockDetails v-if="selectedItem" :item="selectedItem" />
    </BaseModal>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Truck, X } from '@lucide/vue';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import PageFrame from '@/components/ui/PageFrame.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import FilterBar from '@/components/ui/FilterBar.vue';
import type { FilterChip } from '@/components/ui/page-primitives';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import { useListFetch, useListPaging } from '@/composables/useListFetch';
import { dateRangeError } from '@/utils/rules';
import { Color, useUIStore } from '@/stores/ui';
import { apiErrorMessages } from '@/utils/api-error';
import PurchaseOrderLink from '@/components/User/Restock/PurchaseOrderLink.vue';
import RestockDetails from '@/components/User/Restock/DetailsDialog.vue';
import { formatCurrency } from '@/utils/currency';
import { formatStoreDateTime } from '@/utils/datetime';
import {
    purchaseOrderReference,
    type Paginated,
    type RestockRow,
    type UserRef,
} from '@grocery-pos/contracts';
import type { RestockListRow } from '@/components/User/Restock/rows';

const router = useRouter();
const sourceId = computed(() => {
    const candidate = router.currentRoute?.value.query.source;
    return typeof candidate === 'string' && /^[a-f0-9]{24}$/i.test(candidate)
        ? candidate
        : undefined;
});
/** Deep-link filter from a purchase order's "View receipts" (#123). */
const purchaseOrderId = computed(() => {
    const candidate = router.currentRoute?.value.query.purchaseOrder;
    return typeof candidate === 'string' && /^[a-f0-9]{24}$/i.test(candidate)
        ? candidate
        : undefined;
});
// Defensive: the route already needs RESTOCKER/ADMIN (see the helper).
const uiStore = useUIStore();
const { page, limit, search } = useListPaging(() => fetchRestock());
const totalItems = ref(0);
const serverItems = ref<RestockListRow[]>([]);

const headers = [
    { key: 'description', title: 'Description' },
    { key: 'supplier', title: 'Supplier', hideBelow: 'md' as const },
    { key: 'invoiceNumber', title: 'Invoice / DR', hideBelow: 'lg' as const },
    { key: 'purchaseOrder', title: 'Purchase order', hideBelow: 'lg' as const },
    { key: 'totalCost', title: 'Total Cost', align: 'right' as const },
    { key: 'restockedBy', title: 'Restocked By', hideBelow: 'lg' as const },
    { key: 'date', title: 'Date' },
];

const searchRestockedBy = ref<string | null>(null);
const searchDateStart = ref('');
const searchDateEnd = ref('');
const userOptions = ref<Array<{ label: string; value: string }>>([]);

// Only fills the filter's options: a failure is a toast, and the list
// itself still loads.
const fetchUserOptions = async () => {
    try {
        const result = await api.get<UserRef[]>('/restocks/users');
        userOptions.value = result.data.map(({ _id, name }) => ({
            label: name,
            value: _id,
        }));
    } catch (error) {
        uiStore.queueMessage(
            Color.ERROR,
            apiErrorMessages(error, 'Could not load the user filter.'),
        );
    }
};

onMounted(() => {
    void fetchUserOptions();
});

const rangeError = computed(() =>
    dateRangeError(searchDateStart.value, searchDateEnd.value),
);

/**
 * The filters the list was last loaded with: paging and Retry reuse them,
 * so a reversed range still being typed is never sent.
 */
const applied = ref({
    restockedBy: undefined as string | undefined,
    // Calendar days as YYYY-MM-DD (the date input's value). The server
    // reads them in the store timezone; either may be blank.
    dateFrom: undefined as string | undefined,
    dateTo: undefined as string | undefined,
});

/**
 * A filter changed: list page 1 with it, once. A reversed date range is
 * shown on the To field and not sent (the API would refuse it): while it
 * is, the list keeps its last valid range, and a user pick still applies
 * with that range.
 */
const applyFilters = () => {
    const reversed = !!rangeError.value;
    const restockedBy = searchRestockedBy.value ?? undefined;
    if (reversed && restockedBy === applied.value.restockedBy) return;
    applied.value = {
        restockedBy,
        dateFrom: reversed
            ? applied.value.dateFrom
            : searchDateStart.value || undefined,
        dateTo: reversed
            ? applied.value.dateTo
            : searchDateEnd.value || undefined,
    };
    search();
};

// Chips read the applied snapshot and the deep links, never the inputs.
const chips = computed<FilterChip[]>(() => {
    const a = applied.value;
    const out: FilterChip[] = [];
    if (a.restockedBy)
        out.push({
            key: 'restockedBy',
            label: `Restocked by: ${userOptions.value.find((o) => o.value === a.restockedBy)?.label ?? a.restockedBy}`,
            inPanel: true,
        });
    if (a.dateFrom)
        out.push({
            key: 'dateFrom',
            label: `From: ${a.dateFrom}`,
            inPanel: true,
        });
    if (a.dateTo)
        out.push({ key: 'dateTo', label: `To: ${a.dateTo}`, inPanel: true });
    if (purchaseOrderId.value)
        out.push({
            key: 'purchaseOrder',
            label: `Purchase order: ${purchaseOrderReference(purchaseOrderId.value)}`,
        });
    if (sourceId.value)
        out.push({ key: 'source', label: `Source: ${sourceId.value}` });
    return out;
});

/** Drops one applied filter with exactly one reload. */
function removeFilter(key: string) {
    if (key === 'source' || key === 'purchaseOrder') {
        // The route watcher performs the single reload.
        void router.replace({
            query: { ...router.currentRoute.value.query, [key]: undefined },
        });
        return;
    }
    // The inputs go back to the applied range first, so a reversed range
    // still being typed never applies.
    searchRestockedBy.value = applied.value.restockedBy ?? null;
    searchDateStart.value = applied.value.dateFrom ?? '';
    searchDateEnd.value = applied.value.dateTo ?? '';
    if (key === 'restockedBy') searchRestockedBy.value = null;
    if (key === 'dateFrom') searchDateStart.value = '';
    if (key === 'dateTo') searchDateEnd.value = '';
    applied.value = {
        restockedBy: searchRestockedBy.value ?? undefined,
        dateFrom: searchDateStart.value || undefined,
        dateTo: searchDateEnd.value || undefined,
    };
    search();
}

const resetFilters = () => {
    searchRestockedBy.value = null;
    searchDateStart.value = '';
    searchDateEnd.value = '';
    applied.value = {
        restockedBy: undefined,
        dateFrom: undefined,
        dateTo: undefined,
    };
    if (sourceId.value || purchaseOrderId.value) {
        // The route watcher performs the single reload after clearing the
        // deep link; other query parameters belong to the router.
        void router.replace({
            query: {
                ...router.currentRoute.value.query,
                source: undefined,
                purchaseOrder: undefined,
            },
        });
    } else search();
};

const {
    loading,
    error: loadError,
    load: fetchRestock,
} = useListFetch(
    () =>
        api.get<Paginated<RestockRow>>(`/restocks`, {
            params: {
                source: sourceId.value,
                purchaseOrder: purchaseOrderId.value,
                page: page.value,
                limit: limit.value,
                ...applied.value,
            },
        }),
    (result) => {
        serverItems.value = result.data.data.map((restock) => ({
            id: restock._id,
            description: restock.description,
            supplier: restock.supplier?.name ?? 'Unknown supplier',
            invoiceNumber: restock.invoiceNumber || '—',
            ...(restock.purchaseOrder && {
                purchaseOrder: restock.purchaseOrder,
            }),
            restockedBy: restock.restockedBy?.name ?? 'N/A',
            totalCost: formatCurrency(restock.totalCost),
            date: formatStoreDateTime(restock.createdAt),
        }));

        totalItems.value = result.data.totalItems;
    },
    'Could not load the restocks.',
);

// Vue Router reuses this component for source links and ordinary sidebar
// navigation. Follow the current route without applying unsearched inputs.
watch([sourceId, purchaseOrderId], () => search());

void fetchRestock();

const isDialogOpen = ref(false);
const selectedItem = ref<RestockListRow | null>(null);

function showDetails(row: RestockListRow) {
    selectedItem.value = row;
    isDialogOpen.value = true;
}
</script>
