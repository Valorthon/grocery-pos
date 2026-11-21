<template>
    <div>
        <BaseSelect
            v-model="model"
            label="Supplier (required)"
            :options="options"
            :disabled="disabled || loading"
            :error="fieldError"
        />
        <p
            v-if="noSuppliers"
            data-testid="no-suppliers"
            class="mt-1 text-sm text-muted"
        >
            No suppliers yet.
            <template v-if="suppliersHref">
                <a
                    :href="suppliersHref"
                    target="_blank"
                    rel="noopener"
                    class="font-medium underline rounded-control focus-ring"
                    >Add one in Suppliers (opens a new tab)</a
                >, then
                <BaseButton
                    variant="outline"
                    :disabled="disabled"
                    @click="refresh"
                    >Refresh</BaseButton
                >
            </template>
            <template v-else>Ask an admin or restocker to add one.</template>
        </p>
        <p v-if="error" role="alert" class="text-sm text-red-700">
            {{ error }}
            <BaseButton :disabled="disabled" @click="refresh">Retry</BaseButton>
        </p>
    </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useRouter } from 'vue-router';
import { canOpenRoute, type RouteAccessMeta } from '@/router/access';
import { useSuppliers } from '@/composables/useSuppliers';
import { useAuthStore } from '@/stores/auth';
const model = defineModel<string | number | null>({ default: '' });
/** `fieldError`: the inline reason a submit refused this field. */
defineProps<{ disabled?: boolean; fieldError?: string }>();
const { suppliers, loading, error, refresh } = useSuppliers();
const auth = useAuthStore();
const router = useRouter();
// The Suppliers link opens a new tab so an unsaved draft here is never
// discarded (#424); viewers who can't open that page get plain text.
const suppliersHref = computed(() => {
    const target = router?.resolve({ name: 'Suppliers' });
    if (!target) return '';
    const roles = auth.user?.roles ?? [];
    return canOpenRoute(target.meta as RouteAccessMeta, roles)
        ? (target.href ?? '')
        : '';
});
// Only after a load finished, never before the first answer.
const settled = ref(false);
watch(loading, (busy) => {
    if (!busy) settled.value = true;
});
const noSuppliers = computed(
    () =>
        settled.value &&
        !loading.value &&
        !error.value &&
        !suppliers.value.some((row) => row.isActive),
);
const options = computed(() => [
    { label: 'Choose an active supplier', value: '' },
    ...suppliers.value
        .filter((row) => row.isActive)
        .map((row) => ({ label: row.name, value: row._id })),
]);
</script>
