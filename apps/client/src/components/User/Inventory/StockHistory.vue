<template>
    <BaseModal
        :model-value="true"
        :title="`Stock history — ${product.name}`"
        max-width="72rem"
        scrollable
        initial-focus="dialog"
        @update:model-value="
            (value) => {
                if (!value) emit('close');
            }
        "
    >
        <div class="p-5 space-y-4">
            <div
                class="grid grid-cols-2 gap-3 sm:grid-cols-4"
                data-testid="stock-history-tiles"
            >
                <StatTile
                    label="Current stock"
                    :loading="checking"
                    :value="
                        integrity
                            ? formatQuantity(integrity.stock, product.unit)
                            : '—'
                    "
                />
                <StatTile label="Reorder level" :value="reorderLevel || '—'" />
                <StatTile label="EAN" :value="ean || '—'" />
                <div
                    class="flex flex-col gap-1 rounded-card border border-line bg-surface p-4 shadow-card"
                    data-testid="ledger-status"
                    :aria-busy="checking ? 'true' : undefined"
                >
                    <div class="flex items-center justify-between gap-2">
                        <p class="text-xs font-semibold text-muted">Ledger</p>
                        <InfoTooltip label="About stock history balances">
                            Balances follow posting order. Offline sale time is
                            shown separately. Historical backfill balances are
                            derived from known records and an explicitly
                            unattributed opening balance, not verified
                            historical counts.
                        </InfoTooltip>
                    </div>
                    <p
                        v-if="checking"
                        class="h-6 w-24 animate-pulse rounded-control bg-line"
                        data-skeleton
                    >
                        <span class="sr-only">Loading</span>
                    </p>
                    <template v-else-if="integrity">
                        <span data-testid="ledger-badge"
                            ><Badge
                                :color="integrity.matches ? 'success' : 'error'"
                                size="md"
                                >{{
                                    integrity.matches
                                        ? 'Reconciled'
                                        : 'Mismatch'
                                }}</Badge
                            ></span
                        >
                        <p
                            v-if="!integrity.matches"
                            class="text-xs text-danger-fg"
                            role="alert"
                        >
                            Stock
                            {{ formatQuantity(integrity.stock, product.unit) }}
                            · Ledger
                            {{
                                formatQuantity(
                                    integrity.movementTotal,
                                    product.unit,
                                )
                            }}. Investigate before posting more stock.
                        </p>
                    </template>
                    <template v-else>
                        <span data-testid="ledger-badge"
                            ><Badge color="warning" size="md"
                                >Unavailable</Badge
                            ></span
                        >
                        <BaseButton
                            variant="outline"
                            size="sm"
                            class="min-h-11 self-start"
                            @click="loadIntegrity"
                            >Retry check</BaseButton
                        >
                    </template>
                </div>
            </div>
            <FilterBar
                :searchable="false"
                compact
                :active="datesActive"
                @clear="clearDates"
            >
                <DateRangeFilter
                    v-model:from="from"
                    v-model:to="to"
                    :preset="datePreset"
                    :error="rangeError"
                    @preset="pickPreset"
                    @edit="editDate"
                />
            </FilterBar>
            <BaseTable
                :headers="headers"
                :items="rows"
                :loading="loading"
                :error="error"
                @retry="retry"
            >
                <template #cell-posted="{ item }">{{
                    formatStoreDateTime(item.createdAt)
                }}</template>
                <template #cell-occurred="{ item }">{{
                    formatStoreDateTime(item.occurredAt)
                }}</template>
                <template #cell-type="{ item }"
                    >{{ item.type
                    }}{{
                        item.historical ? ' (derived history)' : ''
                    }}</template
                >
                <template #cell-change="{ item }"
                    >{{ item.quantity > 0 ? '+' : ''
                    }}{{ formatQuantity(item.quantity, item.unit) }}</template
                >
                <template #cell-balance="{ item }">{{
                    formatQuantity(item.balanceAfter, item.unit)
                }}</template>
                <template #cell-source="{ item }">
                    <RouterLink
                        v-if="sourceLink(item)"
                        class="underline"
                        :to="sourceLink(item)!"
                        >{{ item.refModel }}
                        {{ item.refId?.slice(-8) }}</RouterLink
                    ><span v-else>{{
                        item.refId
                            ? `${item.refModel} ${item.refId}`
                            : 'Unattributed opening balance'
                    }}</span>
                </template>
                <template #cell-user="{ item }">{{
                    item.user?.name ?? 'Unknown / unattributed'
                }}</template>
                <template #empty>
                    <EmptyState
                        title="No matching stock movements."
                        hint="Try another posting date range."
                    >
                        <template #icon><History :size="24" /></template>
                    </EmptyState>
                </template>
            </BaseTable>
            <div v-if="!error" class="flex items-center gap-3 text-sm">
                <BaseButton
                    variant="outline"
                    :disabled="loading || page === 1"
                    @click="
                        page--;
                        load();
                    "
                    >Previous</BaseButton
                >
                <span>Page {{ page }} · {{ total }} movements</span>
                <BaseButton
                    variant="outline"
                    :disabled="loading || page * 20 >= total"
                    @click="
                        page++;
                        load();
                    "
                    >Next</BaseButton
                >
            </div>
        </div>
    </BaseModal>
</template>
<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import {
    formatQuantity,
    StockMovementSource,
    Role,
    type ProductView,
    type StockMovementView,
    type StockIntegrityView,
    type Paginated,
} from '@grocery-pos/contracts';
import api from '@/axios';
import BaseModal from '@/components/ui/BaseModal.vue';
import Badge from '@/components/ui/Badge.vue';
import StatTile from '@/components/ui/StatTile.vue';
import InfoTooltip from '@/components/ui/InfoTooltip.vue';
import FilterBar from '@/components/ui/FilterBar.vue';
import DateRangeFilter from '@/components/ui/DateRangeFilter.vue';
import { useDatePreset } from '@/composables/useDatePreset';
import type { DatePreset } from '@/views/User/Reports/presets';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import type { TableHeader } from '@/components/ui/types';
import { History } from '@lucide/vue';
import { useAuthStore } from '@/stores/auth';
import { apiErrorText } from '@/utils/api-error';
import { dateRangeError } from '@/utils/rules';
import { formatStoreDateTime } from '@/utils/datetime';
const props = defineProps<{
    product: Pick<ProductView, '_id' | 'name' | 'unit'>;
    /** Shown in the dialog for lists that hide it at phone width (#210). */
    ean?: string;
    /** Formatted reorder level, shown like `ean`. */
    reorderLevel?: string;
}>();
const emit = defineEmits<{ (event: 'close'): void }>();
const auth = useAuthStore();
const rows = ref<StockMovementView[]>([]),
    integrity = ref<StockIntegrityView | null>(null);
const loading = ref(false),
    checking = ref(false),
    error = ref(''),
    from = ref(''),
    to = ref(''),
    page = ref(1),
    total = ref(0);
const rangeError = computed(() => dateRangeError(from.value, to.value));
const headers: TableHeader[] = [
    { key: 'posted', title: 'Posted' },
    { key: 'occurred', title: 'Occurred' },
    { key: 'type', title: 'Type' },
    { key: 'change', title: 'Change', align: 'right' },
    { key: 'balance', title: 'Balance after', align: 'right' },
    { key: 'source', title: 'Source' },
    { key: 'user', title: 'Recorded user' },
];
let applied: { from?: string; to?: string } = {},
    generation = 0,
    checkGeneration = 0;
function sourceLink(row: StockMovementView): RouteLocationRaw | undefined {
    if (!row.refId) return undefined;
    if (row.refModel === StockMovementSource.SALE && auth.isAdmin)
        return { name: 'SalesHistory', query: { saleNumber: row.refId } };
    if (
        row.refModel === StockMovementSource.RESTOCK &&
        (auth.isAdmin || auth.hasRole(Role.Restocker))
    )
        return { name: 'Restocks', query: { source: row.refId } };
    if (
        row.refModel === StockMovementSource.ADJUSTMENT &&
        (auth.isAdmin || auth.hasRole(Role.Adjuster))
    )
        return { name: 'Adjustments', query: { source: row.refId } };
    if (
        row.refModel === StockMovementSource.COUNT &&
        (auth.isAdmin || auth.hasRole(Role.Adjuster))
    )
        return { name: 'StockCounts', query: { source: row.refId } };
}
/** A pick or hand edit applies at once on page 1; a reversed range is held. */
function apply() {
    if (rangeError.value) return;
    applied = { from: from.value || undefined, to: to.value || undefined };
    page.value = 1;
    void load();
}
const {
    preset: datePreset,
    choose: choosePreset,
    edited: presetEdited,
    reset: resetPreset,
} = useDatePreset(from, to, apply);
function pickPreset(value: string | null) {
    void choosePreset(value as DatePreset | null);
}
function editDate() {
    presetEdited();
    apply();
}
const datesActive = computed(
    () => !!(from.value || to.value || datePreset.value),
);
function clearDates() {
    resetPreset();
    from.value = '';
    to.value = '';
    apply();
}
/** The movements page; its failure shows in the table only. */
async function load() {
    const turn = ++generation,
        owner = auth.user?.userId;
    loading.value = true;
    error.value = '';
    try {
        const history = await api.get<Paginated<StockMovementView>>(
            `/products/${props.product._id}/movements`,
            { params: { ...applied, page: page.value, limit: 20 } },
        );
        if (turn !== generation || owner !== auth.user?.userId) return;
        rows.value = history.data.data;
        total.value = history.data.totalItems;
    } catch (cause) {
        if (turn === generation && owner === auth.user?.userId)
            error.value = apiErrorText(cause, 'Could not load stock history.');
    } finally {
        if (turn === generation) loading.value = false;
    }
}
/** The ledger check, loaded once on open and again on Retry (#258). */
async function loadIntegrity() {
    const turn = ++checkGeneration,
        owner = auth.user?.userId;
    checking.value = true;
    integrity.value = null;
    try {
        const check = await api.get<StockIntegrityView>(
            `/products/${props.product._id}/movements/integrity`,
        );
        if (turn !== checkGeneration || owner !== auth.user?.userId) return;
        integrity.value = check.data;
    } catch {
        // Unavailable: the tile shows "—", never a false "Reconciled".
    } finally {
        if (turn === checkGeneration) checking.value = false;
    }
}
function retry() {
    void load();
    if (!integrity.value && !checking.value) void loadIntegrity();
}
watch(
    () => auth.user?.userId,
    () => {
        generation++;
        checkGeneration++;
        rows.value = [];
        integrity.value = null;
        emit('close');
    },
);
watch(
    () => props.product._id,
    () => {
        rows.value = [];
        integrity.value = null;
        page.value = 1;
        void load();
        void loadIntegrity();
    },
);
onBeforeUnmount(() => {
    generation++;
    checkGeneration++;
});
void load();
void loadIntegrity();
</script>
