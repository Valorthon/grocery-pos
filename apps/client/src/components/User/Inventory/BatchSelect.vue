<template>
    <div class="space-y-2">
        <label class="block text-sm font-medium"
            >Inventory batch
            <select
                v-model="selected"
                class="w-full min-h-11 rounded-xl border border-slate-300 px-3"
                :disabled="loading"
            >
                <option value="">Choose a batch</option>
                <option
                    v-for="batch in batches"
                    :key="batch._id"
                    :value="batch._id"
                >
                    {{ batch.batchNo || batch._id.slice(-8) }} ·
                    {{ batch.expiryDate || 'Reconciliation / expiry unknown' }}
                    ·
                    {{ formatQuantity(batch.remainingQty, batch.product.unit) }}
                </option>
            </select>
        </label>
        <p v-if="error" role="alert" class="text-sm text-red-700">
            {{ error }} <button type="button" @click="load">Retry</button>
        </p>
        <div class="flex gap-3 text-sm">
            <button v-if="page > 1" type="button" @click="page--">
                Previous batches</button
            ><button v-if="page * 100 < total" type="button" @click="page++">
                More batches
            </button>
        </div>
    </div>
</template>
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import {
    formatQuantity,
    type InventoryBatchView,
    type Paginated,
} from '@grocery-pos/contracts';
import api from '@/axios';
import { apiErrorText } from '@/utils/api-error';
const props = defineProps<{ product: string }>();
const selected = defineModel<string>({ default: '' });
const batches = ref<InventoryBatchView[]>([]);
const page = ref(1),
    total = ref(0),
    loading = ref(false),
    error = ref('');
let generation = 0;
onBeforeUnmount(() => generation++);
async function load() {
    const request = ++generation;
    batches.value = [];
    error.value = '';
    loading.value = true;
    if (!props.product) {
        loading.value = false;
        return;
    }
    try {
        const result = await api.get<Paginated<InventoryBatchView>>(
            '/inventories/batches',
            {
                params: {
                    product: props.product,
                    page: page.value,
                    limit: 100,
                },
            },
        );
        if (request !== generation) return;
        batches.value = result.data.data;
        total.value = result.data.totalItems;
    } catch (cause) {
        if (request === generation) error.value = apiErrorText(cause);
    } finally {
        if (request === generation) loading.value = false;
    }
}
watch(
    () => props.product,
    () => {
        page.value = 1;
        void load();
    },
);
watch(page, () => void load());
void load();
</script>
