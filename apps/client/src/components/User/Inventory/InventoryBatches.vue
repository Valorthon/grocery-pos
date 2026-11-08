<template>
    <section
        class="mt-6 rounded-2xl border border-slate-200 bg-white p-5 space-y-4"
        aria-labelledby="batch-heading"
    >
        <h2 id="batch-heading" class="text-lg font-bold">
            Expiry and inventory batches
        </h2>
        <p class="text-sm">
            Expiry dates are store calendar days. Stock is usable through its
            expiry date. Expired batches cannot be sold. Reconciliation batches
            need review.
        </p>
        <div class="flex flex-wrap items-end gap-3">
            <BaseInput
                v-model="days"
                label="Expiring within days (expired included)"
                type="number"
                :min="0"
                :max="EXPIRY_LIMITS.DAYS_MAX"
            />
            <BaseButton :disabled="loading" @click="search"
                >Show expiring</BaseButton
            >
            <BaseButton variant="outline" :disabled="loading" @click="showAll"
                >All remaining batches</BaseButton
            >
        </div>
        <p v-if="daysError" role="alert" class="text-sm text-danger-fg">
            {{ daysError }}
        </p>
        <BaseTable
            :headers="headers"
            :items="rows"
            :loading="loading"
            :error="error"
            @retry="load"
        >
            <template #cell-product="{ item }">{{
                item.product.name
            }}</template>
            <template #cell-batch="{ item }">{{
                item.batchNo || item._id.slice(-8)
            }}</template>
            <template #cell-expiry="{ item }">{{
                item.expiryDate || 'Reconciliation / unknown'
            }}</template>
            <template #cell-daysLeft="{ item }">{{
                item.daysLeft === undefined
                    ? '—'
                    : item.daysLeft < 0
                      ? `Expired ${-item.daysLeft} days ago`
                      : item.daysLeft
            }}</template>
            <template #cell-remaining="{ item }">{{
                formatQuantity(item.remainingQty, item.product.unit)
            }}</template>
            <template #cell-action="{ item }">
                <BaseButton
                    v-if="canAdjust && item.remainingQty > 0"
                    size="sm"
                    variant="outline"
                    @click="writeOff(item)"
                    >Write off</BaseButton
                >
            </template>
            <template #empty>
                <EmptyState
                    title="No matching batches."
                    hint="Widen the expiry window or show all remaining batches."
                >
                    <template #icon><PackageSearch :size="24" /></template>
                </EmptyState>
            </template>
        </BaseTable>
        <div class="flex gap-3">
            <BaseButton
                v-if="page > 1"
                variant="outline"
                :disabled="loading"
                @click="
                    page--;
                    load();
                "
                >Previous</BaseButton
            ><BaseButton
                v-if="page * 25 < total"
                variant="outline"
                :disabled="loading"
                @click="
                    page++;
                    load();
                "
                >Next</BaseButton
            >
        </div>
    </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
    EXPIRY_LIMITS,
    Role,
    formatQuantity,
    type InventoryBatchView,
    type Paginated,
} from '@grocery-pos/contracts';
import api from '@/axios';
import { apiErrorText } from '@/utils/api-error';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import type { TableHeader } from '@/components/ui/types';
import { PackageSearch } from '@lucide/vue';
import { useAuthStore } from '@/stores/auth';
import { useAdjustmentPrefillStore } from '@/stores/adjustmentPrefill';
const auth = useAuthStore(),
    router = useRouter(),
    prefill = useAdjustmentPrefillStore();
const canAdjust = computed(() => auth.isAdmin || auth.hasRole(Role.Adjuster));
const days = ref<number | string>(EXPIRY_LIMITS.DEFAULT_DAYS),
    page = ref(1),
    total = ref(0),
    expiring = ref(true),
    loading = ref(false),
    error = ref(''),
    daysError = ref(''),
    rows = ref<InventoryBatchView[]>([]);
const headers: TableHeader[] = [
    { key: 'product', title: 'Product' },
    { key: 'batch', title: 'Batch' },
    { key: 'expiry', title: 'Expiry' },
    { key: 'daysLeft', title: 'Days left', align: 'right' },
    { key: 'remaining', title: 'Remaining', align: 'right' },
    { key: 'action', title: 'Action', align: 'right' },
];
let generation = 0;
onBeforeUnmount(() => generation++);
async function load() {
    const request = ++generation;
    loading.value = true;
    error.value = '';
    daysError.value = '';
    const value = Number(days.value);
    if (
        expiring.value &&
        (String(days.value).trim() === '' ||
            !Number.isInteger(value) ||
            value < 0 ||
            value > EXPIRY_LIMITS.DAYS_MAX)
    ) {
        daysError.value = 'Enter a whole number of days from 0 to 365.';
        loading.value = false;
        return;
    }
    try {
        const response = await api.get<Paginated<InventoryBatchView>>(
            expiring.value ? '/inventories/expiring' : '/inventories/batches',
            {
                params: {
                    page: page.value,
                    limit: 25,
                    ...(expiring.value && { days: value }),
                },
            },
        );
        if (request !== generation) return;
        rows.value = response.data.data;
        total.value = response.data.totalItems;
    } catch (cause) {
        if (request === generation) {
            error.value = apiErrorText(cause);
            rows.value = [];
        }
    } finally {
        if (request === generation) loading.value = false;
    }
}
function search() {
    expiring.value = true;
    page.value = 1;
    void load();
}
function showAll() {
    expiring.value = false;
    page.value = 1;
    void load();
}
async function writeOff(batch: InventoryBatchView) {
    if (canAdjust.value && prefill.prepare(batch))
        await router.push({ name: 'Adjustments/Add' });
}
void load();
</script>
