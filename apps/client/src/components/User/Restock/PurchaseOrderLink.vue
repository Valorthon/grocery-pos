<template>
    <button
        v-if="purchaseOrder && canOpenOrders"
        type="button"
        class="min-h-11 text-leaf-700 underline"
        data-testid="purchase-order-link"
        @click.stop="openOrder(purchaseOrder)"
    >
        {{ purchaseOrderReference(purchaseOrder) }}
    </button>
    <span v-else-if="purchaseOrder">{{
        purchaseOrderReference(purchaseOrder)
    }}</span>
    <span v-else>—</span>
</template>

<script setup lang="ts">
/**
 * A restock's purchase order (#123): a link to it when the viewer may
 * open Purchase Orders, else its reference; a dash without one. Shared by
 * the Restock History cell and the details dialog (#208).
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { purchaseOrderReference } from '@grocery-pos/contracts';
import { useAuthStore } from '@/stores/auth';
import { canOpenPurchaseOrders } from '@/views/User/Restock/purchase-order-link';

defineProps<{ purchaseOrder?: string | null }>();

const router = useRouter();
const authStore = useAuthStore();
const canOpenOrders = computed(() =>
    canOpenPurchaseOrders((role) => authStore.hasRole(role)),
);
function openOrder(id: string) {
    void router.push({ name: 'PurchaseOrders', query: { id } });
}
</script>
