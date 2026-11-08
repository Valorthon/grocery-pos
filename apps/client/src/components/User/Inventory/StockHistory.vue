<template>
    <BaseModal
        :model-value="true"
        :title="`Stock history — ${product.name}`"
        max-width="72rem"
        scrollable
        @update:model-value="
            (value) => {
                if (!value) emit('close');
            }
        "
    >
        <div class="p-5 space-y-4">
            <p class="text-sm">
                Balances follow posting order. Offline sale time is shown
                separately. Historical backfill balances are derived from known
                records and an explicitly unattributed opening balance, not
                verified historical counts.
            </p>
            <div class="flex flex-wrap items-end gap-3">
                <BaseInput v-model="from" label="Posted from" type="date" />
                <BaseInput
                    v-model="to"
                    label="Posted to"
                    type="date"
                    :error="rangeError"
                />
                <BaseButton :disabled="loading" @click="search"
                    >Search</BaseButton
                >
            </div>
            <p
                v-if="integrity"
                class="text-sm"
                :class="integrity.matches ? 'text-emerald-800' : 'text-red-700'"
                :role="integrity.matches ? undefined : 'alert'"
            >
                {{
                    integrity.matches
                        ? 'Ledger reconciles with current stock.'
                        : 'Ledger does not reconcile; investigate before posting more stock.'
                }}
                Stock: {{ formatQuantity(integrity.stock, product.unit) }} ·
                Ledger:
                {{ formatQuantity(integrity.movementTotal, product.unit) }}
            </p>
            <BaseTable
                :headers="headers"
                :items="rows"
                :loading="loading && !rows.length"
                :error="error"
                @retry="load"
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
import BaseInput from '@/components/ui/BaseInput.vue';
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
}>();
const emit = defineEmits<{ (event: 'close'): void }>();
const auth = useAuthStore();
const rows = ref<StockMovementView[]>([]),
    integrity = ref<StockIntegrityView | null>(null);
const loading = ref(false),
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
    generation = 0;
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
function search() {
    if (rangeError.value) return;
    applied = { from: from.value || undefined, to: to.value || undefined };
    page.value = 1;
    void load();
}
async function load() {
    const turn = ++generation,
        owner = auth.user?.userId;
    loading.value = true;
    error.value = '';
    try {
        const [history, check] = await Promise.all([
            api.get<Paginated<StockMovementView>>(
                `/products/${props.product._id}/movements`,
                { params: { ...applied, page: page.value, limit: 20 } },
            ),
            api.get<StockIntegrityView>(
                `/products/${props.product._id}/movements/integrity`,
            ),
        ]);
        if (turn !== generation || owner !== auth.user?.userId) return;
        rows.value = history.data.data;
        total.value = history.data.totalItems;
        integrity.value = check.data;
    } catch (cause) {
        if (turn === generation && owner === auth.user?.userId)
            error.value = apiErrorText(cause, 'Could not load stock history.');
    } finally {
        if (turn === generation) loading.value = false;
    }
}
watch(
    () => auth.user?.userId,
    () => {
        generation++;
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
    },
);
onBeforeUnmount(() => generation++);
void load();
</script>
