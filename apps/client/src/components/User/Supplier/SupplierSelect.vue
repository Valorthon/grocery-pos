<template>
    <BaseSelect
        v-model="model"
        label="Supplier (required)"
        :options="options"
        :disabled="disabled || loading"
    />
    <p v-if="error" role="alert" class="text-sm text-red-700">
        {{ error }}
        <BaseButton :disabled="disabled" @click="refresh">Retry</BaseButton>
    </p>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useSuppliers } from '@/composables/useSuppliers';
const model = defineModel<string | number | null>({ default: '' });
defineProps<{ disabled?: boolean }>();
const { suppliers, loading, error, refresh } = useSuppliers();
const options = computed(() => [
    { label: 'Choose an active supplier', value: '' },
    ...suppliers.value
        .filter((row) => row.isActive)
        .map((row) => ({ label: row.name, value: row._id })),
]);
</script>
