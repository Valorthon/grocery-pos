<template>
    <div>
        <BaseSelect
            v-model="selection"
            label="Category"
            :options="options"
            all-label="Uncategorized"
            :disabled="loading || !!error"
        />
        <p v-if="error" role="alert" class="text-sm text-red-700">
            {{ error }}
            <button type="button" class="min-h-11 underline" @click="refresh">
                Retry
            </button>
        </p>
    </div>
</template>
<script setup lang="ts">
import { computed, watch } from 'vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import { useCategories } from '@/composables/useCategories';
const model = defineModel<string | undefined>();
const props = defineProps<{ current?: string | null; refreshKey?: boolean }>();
const { categories, loading, error, refresh } = useCategories();
watch(
    () => props.refreshKey,
    (value) => {
        if (value) void refresh();
    },
);
const options = computed(() => {
    const rows = categories.value
        .filter((row) => row.isActive || row._id === props.current)
        .map((row) => ({
            value: row._id,
            label: row.name + (row.isActive ? '' : ' (archived)'),
        }));
    if (props.current && !rows.some((row) => row.value === props.current))
        rows.push({
            value: props.current,
            label: 'Unavailable category (unchanged)',
        });
    return rows;
});
const selection = computed({
    get: () => model.value ?? null,
    set: (value: string | number | null) => {
        model.value = typeof value === 'string' && value ? value : undefined;
    },
});
</script>
