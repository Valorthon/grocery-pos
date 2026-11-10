<template>
    <section
        class="mt-6 rounded-2xl border border-slate-200 bg-white p-5 space-y-4"
        aria-labelledby="batch-heading"
    >
        <h2
            id="batch-heading"
            ref="heading"
            tabindex="-1"
            class="text-lg font-bold focus:outline-none"
        >
            Expiry and inventory batches
        </h2>
        <p class="text-sm">
            Expiry dates are store calendar days. Stock is usable through its
            expiry date. Expired batches cannot be sold. Reconciliation batches
            need review.
        </p>
        <p
            v-if="trackedProducts === 0"
            class="text-sm text-muted"
            data-testid="no-expiry-tracking"
        >
            No products track expiry.
        </p>
        <template v-else>
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
                <BaseButton
                    variant="outline"
                    :disabled="loading"
                    @click="showAll"
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
                <template #cell-product="{ item }"
                    ><ProductCell
                        :name="item.product.name"
                        :ean="item.product.EAN"
                /></template>

                <template #cell-batch="{ item }">{{
                    item.batchNo || item._id.slice(-8)
                }}</template>
                <!-- The badge sits under the date: no new column (#242). -->
                <template #cell-expiry="{ item }"
                    ><span class="block">{{
                        item.expiryDate || 'Reconciliation / unknown'
                    }}</span
                    ><span class="mt-1 block"
                        ><StatusBadge
                            :status="batchStatus(item)"
                            :map="BATCH_STATUS"
                            data-testid="batch-status" /></span
                ></template>
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
        </template>
    </section>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
    EXPIRY_LIMITS,
    Role,
    formatQuantity,
    type ExpiryTrackingView,
    type InventoryBatchView,
    type Paginated,
} from '@grocery-pos/contracts';
import api from '@/axios';
import { apiErrorText } from '@/utils/api-error';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseTable from '@/components/ui/BaseTable.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ProductCell from '@/components/ui/ProductCell.vue';
import StatusBadge from '@/components/ui/StatusBadge.vue';
import type { StatusMap } from '@/components/ui/status-badge';
import type { TableHeader } from '@/components/ui/types';
import { PackageSearch } from '@lucide/vue';
import { useAuthStore } from '@/stores/auth';
import { useAdjustmentPrefillStore } from '@/stores/adjustmentPrefill';
import { useSettingsStore } from '@/stores/settings';
const props = defineProps<{
    /** Scroll to and focus the heading once the first load settles (#233). */
    focusOnLoad?: boolean;
}>();
const heading = ref<HTMLElement | null>(null);
/** Active products that track expiry; null while unknown (#233). */
const trackedProducts = ref<number | null>(null);
const auth = useAuthStore(),
    router = useRouter(),
    prefill = useAdjustmentPrefillStore();
const canAdjust = computed(() => auth.isAdmin || auth.hasRole(Role.Adjuster));
const settings = useSettingsStore();
/** Starts at the store's expiry alert window, like the dashboard tile (#213). */
const days = ref<number | string>(settings.settings.expiryAlertDays),
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
type BatchStatus = 'expired' | 'soon' | 'ok' | 'check' | 'reconciliation';
/** Expiring soon means within the store's alert window, like the dashboard (#213). */
function batchStatus(batch: InventoryBatchView): BatchStatus {
    if (!batch.expiryDate) return 'reconciliation';
    // A dated lot without the server's day count: flag it for a look.
    if (batch.daysLeft === undefined) return 'check';
    if (batch.daysLeft < 0) return 'expired';
    return batch.daysLeft <= settings.settings.expiryAlertDays ? 'soon' : 'ok';
}
const BATCH_STATUS: StatusMap<BatchStatus> = {
    expired: { label: 'Expired', color: 'error' },
    soon: { label: 'Expiring soon', color: 'warning' },
    ok: { label: 'OK', color: 'success' },
    check: { label: 'Check expiry', color: 'warning' },
    reconciliation: { label: 'Reconciliation', color: 'neutral' },
};
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
/** A failed or odd answer stays unknown, so the table still shows. */
async function loadTracking() {
    try {
        const { trackedProducts: count } = (
            await api.get<ExpiryTrackingView>('/inventories/expiry-tracking')
        ).data;
        if (Number.isSafeInteger(count)) trackedProducts.value = count;
    } catch {
        trackedProducts.value = null;
    }
}
/** Read the committed window first; a failed refresh keeps the last-known one. */
async function start() {
    const initial = days.value;
    await settings.refresh();
    if (days.value === initial) days.value = settings.settings.expiryAlertDays;
    await Promise.all([load(), loadTracking()]);
    if (!props.focusOnLoad) return;
    await nextTick();
    heading.value?.scrollIntoView({ block: 'start' });
    heading.value?.focus();
}
void start();
</script>
