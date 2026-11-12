<template>
    <div class="text-sm num" data-testid="product-cost">
        <span v-if="loading">Loading cost…</span>
        <span v-else-if="error" role="alert"
            >{{ error }}
            <button class="min-h-11 underline" @click="load">
                Retry
            </button></span
        >
        <div
            v-else-if="tiles"
            class="grid grid-cols-2 gap-3"
            data-testid="cost-tiles"
        >
            <StatTile
                compact
                label="Latest cost"
                :value="
                    cost?.lastCost === undefined
                        ? 'Unknown'
                        : `${formatCurrency(cost.lastCost)}/${unitLabel(unit)}`
                "
                data-testid="tile-cost"
            />
            <StatTile
                compact
                label="Margin"
                :help="MARGIN_HELP"
                :value="
                    live === undefined
                        ? '—'
                        : `${(live.basisPoints / 100).toFixed(2)}%`
                "
                :hint="
                    live === undefined
                        ? undefined
                        : `${formatCurrency(live.profit)}/${unitLabel(unit)} profit`
                "
                :tone="live && live.profit < 0 ? 'danger' : 'neutral'"
                tone-label="negative margin"
                :value-class="
                    live && live.profit < 0 ? 'text-danger-fg' : undefined
                "
                data-testid="tile-margin"
            />
        </div>
        <template v-else-if="cost?.lastCost !== undefined">
            Latest receipt: {{ formatCurrency(cost.lastCost) }}/{{
                unitLabel(unit)
            }}
            <span v-if="cost.marginBasisPoints !== undefined">
                · Margin estimate:
                {{ (cost.marginBasisPoints / 100).toFixed(2) }}%</span
            >
        </template>
        <span v-else>Cost unknown · margin unavailable</span>
    </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
    marginBasisPoints,
    unitLabel,
    type ProductCostView,
    type UnitOfMeasure,
} from '@grocery-pos/contracts';
import api from '@/axios';
import StatTile from '@/components/ui/StatTile.vue';
import { apiErrorText } from '@/utils/api-error';
import { formatCurrency } from '@/utils/currency';
const MARGIN_HELP =
    'An estimate from the latest receipt cost, not FIFO or average cost.';
const props = defineProps<{
    product: string;
    unit?: UnitOfMeasure;
    /** Edit Product: cost and live margin as tiles (#290). */
    tiles?: boolean;
    /** Typed price in centavos; null when invalid or empty. */
    price?: number | null;
}>();
/** Margin from the typed price, with the server's integer formula. */
const live = computed(() => {
    const price = props.price,
        basis = cost.value?.lastCost;
    if (price == null || basis === undefined) return undefined;
    const basisPoints = marginBasisPoints(price, basis);
    return basisPoints === undefined
        ? undefined
        : { basisPoints, profit: price - basis };
});
const cost = ref<ProductCostView>(),
    loading = ref(false),
    error = ref('');
let generation = 0;
async function load() {
    const current = ++generation;
    cost.value = undefined;
    error.value = '';
    loading.value = true;
    try {
        const result = await api.get<ProductCostView[]>('/suppliers/costs', {
            params: { products: props.product },
        });
        if (current === generation) cost.value = result.data[0];
    } catch (cause) {
        if (current === generation)
            error.value = apiErrorText(cause, 'Unable to load cost.');
    } finally {
        if (current === generation) loading.value = false;
    }
}
watch(() => props.product, load, { immediate: true });
onBeforeUnmount(() => {
    generation++;
});
</script>
