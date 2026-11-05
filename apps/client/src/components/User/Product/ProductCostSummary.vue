<template>
    <div class="text-sm" data-testid="product-cost">
        <span v-if="loading">Loading cost…</span>
        <span v-else-if="error" role="alert"
            >{{ error }}
            <button class="min-h-11 underline" @click="load">
                Retry
            </button></span
        >
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
import { onBeforeUnmount, ref, watch } from 'vue';
import {
    unitLabel,
    type ProductCostView,
    type UnitOfMeasure,
} from '@grocery-pos/contracts';
import api from '@/axios';
import { apiErrorText } from '@/utils/api-error';
import { formatCurrency } from '@/utils/currency';
const props = defineProps<{ product: string; unit?: UnitOfMeasure }>();
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
