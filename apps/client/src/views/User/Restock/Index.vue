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
                compact
                :active="filtersActive"
                class="px-5 py-4 border-b border-line"
                @clear="resetFilters"
            >
                <DateRangeFilter
                    v-model:from="searchDateStart"
                    v-model:to="searchDateEnd"
                    :preset="datePreset"
                    :error="rangeError"
                    @preset="pickPreset"
                    @edit="editDate"
                />
                <BaseSelect
                    v-model="searchRestockedBy"
                    :options="userOptions"
                    aria-label="Restocked By"
                    all-label="All users"
                    @update:model-value="applyFilters"
                />
            </FilterBar>
            <p
                v-if="deepLinkNote"
                class="px-5 py-2 text-sm text-muted"
                data-testid="deep-link-note"
            >
                {{ deepLinkNote }}
            </p>

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
                <template #cell-supplier="{ item }">{{
                    item.supplier ?? 'Unknown supplier'
                }}</template>
                <template #cell-invoiceNumber="{ item }">{{
                    item.invoiceNumber ?? '—'
                }}</template>
                <template #cell-purchaseOrder="{ item }">
                    <PurchaseOrderLink :purchase-order="item.purchaseOrder" />
                </template>
                <template #cell-restockedBy="{ item }">{{
                    item.restockedBy ?? 'N/A'
                }}</template>
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
import { Truck } from '@lucide/vue';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import PageFrame from '@/components/ui/PageFrame.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import FilterBar from '@/components/ui/FilterBar.vue';
import DateRangeFilter from '@/components/ui/DateRangeFilter.vue';
import { useDatePreset } from '@/composables/useDatePreset';
import { type DatePreset } from '@/views/User/Reports/presets';
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
/** The deep links have no field, so a muted line names them (#215). */
const deepLinkNote = computed(() =>
    [
        purchaseOrderId.value &&
            `Showing receipts for ${purchaseOrderReference(purchaseOrderId.value)}`,
        sourceId.value && `Showing the restock from source ${sourceId.value}`,
    ]
        .filter(Boolean)
        .join(' · '),
);
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

const {
    preset: datePreset,
    choose: choosePreset,
    edited: presetEdited,
    reset: resetPreset,
} = useDatePreset(searchDateStart, searchDateEnd, applyFilters);
/** A preset fills both dates, then applies once (#215). */
function pickPreset(value: string | null) {
    void choosePreset(value as DatePreset | null);
}
/** A manual date edit switches the preset to Custom and applies. */
function editDate() {
    presetEdited();
    applyFilters();
}

/** Clear Filters is enabled while any filter, preset or deep link is set. */
const filtersActive = computed(
    () =>
        !!(
            searchRestockedBy.value ||
            searchDateStart.value ||
            searchDateEnd.value ||
            datePreset.value ||
            Object.values(applied.value).some(Boolean) ||
            sourceId.value ||
            purchaseOrderId.value
        ),
);

const resetFilters = () => {
    resetPreset();
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
            supplier: restock.supplier?.name,
            invoiceNumber: restock.invoiceNumber || undefined,
            ...(restock.purchaseOrder && {
                purchaseOrder: restock.purchaseOrder,
            }),
            restockedBy: restock.restockedBy?.name,
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
