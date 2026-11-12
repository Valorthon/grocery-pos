<template>
    <div class="text-sm num" data-testid="product-cost">
        <span v-if="loading" class="text-muted">Loading cost…</span>
        <span v-else-if="error" role="alert"
            >{{ error }}
            <button class="min-h-11 underline" @click="load">
                Retry
            </button></span
        >
        <!-- Plain labelled read-only boxes on the price input's row:
             labels share a line, boxes are input-high (#294). -->
        <div
            v-else-if="tiles"
            class="grid min-w-0 grid-cols-2 gap-3 items-start"
            data-testid="cost-tiles"
        >
            <div class="min-w-0" data-testid="tile-cost">
                <p :id="`${uid}-cost`" :class="FIELD_LABEL">Latest cost</p>
                <output
                    :aria-labelledby="`${uid}-cost`"
                    :class="['block', FIELD_READONLY]"
                    data-readonly-box
                    >{{
                        cost?.lastCost === undefined
                            ? 'Unknown'
                            : `${formatCurrency(cost.lastCost)}/${unitLabel(unit)}`
                    }}</output
                >
            </div>
            <!-- Red on a negative profit: selling below the latest cost is
                 a real loss per unit (#290), named for screen readers. -->
            <div class="min-w-0" data-testid="tile-margin">
                <div class="flex items-center gap-1 mb-1.5">
                    <p :id="`${uid}-margin`" :class="[FIELD_LABEL, 'mb-0']">
                        Margin<span v-if="negative" class="sr-only"
                            >, negative margin</span
                        >
                    </p>
                    <InfoTooltip class="-my-3 -ml-3.5" label="About margin">{{
                        MARGIN_HELP
                    }}</InfoTooltip>
                </div>
                <output
                    :aria-labelledby="`${uid}-margin`"
                    :class="[
                        'block',
                        FIELD_READONLY,
                        negative ? 'text-danger-fg' : '',
                    ]"
                    data-readonly-box
                    >{{
                        live === undefined
                            ? '—'
                            : `${(live.basisPoints / 100).toFixed(2)}% · ${formatCurrency(live.profit)}/${unitLabel(unit)}`
                    }}</output
                >
            </div>
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
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import {
    marginBasisPoints,
    unitLabel,
    type ProductCostView,
    type UnitOfMeasure,
} from '@grocery-pos/contracts';
import api from '@/axios';
import InfoTooltip from '@/components/ui/InfoTooltip.vue';
import { FIELD_LABEL, FIELD_READONLY } from '@/components/ui/field-style';
import { apiErrorText } from '@/utils/api-error';
import { formatCurrency } from '@/utils/currency';
const MARGIN_HELP =
    'An estimate from the latest receipt cost, not FIFO or average cost.';
const props = defineProps<{
    product: string;
    unit?: UnitOfMeasure;
    /** Edit Product: cost and live margin as read-only fields (#290, #294). */
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
const uid = useId();
const negative = computed(
    () => live.value !== undefined && live.value.profit < 0,
);
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
