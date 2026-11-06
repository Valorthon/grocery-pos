import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import {
    quantityInput,
    reorderQuantityOf,
    type InventoryRow,
} from '@grocery-pos/contracts';
import type { PurchaseOrderDraftLine } from '@/components/User/PurchaseOrder/purchase-order';
import { useAuthStore } from './auth';

/** Low-stock handoff into an unsaved PO draft (#123): in memory, consumed once. */
export const usePurchaseOrderPrefillStore = defineStore(
    'purchase-order-prefill',
    () => {
        const auth = useAuthStore();
        const owner = ref<string>();
        const lines = ref<PurchaseOrderDraftLine[]>([]);
        watch(
            () => auth.user?.userId,
            () => {
                owner.value = undefined;
                lines.value = [];
            },
            { flush: 'sync' },
        );
        function prepare(rows: InventoryRow[]) {
            if (!auth.user?.userId) return false;
            owner.value = auth.user.userId;
            lines.value = rows.map(({ product }) => ({
                product: product._id,
                name: product.name,
                EAN: product.EAN,
                unit: product.unit,
                tracksExpiry: product.tracksExpiry,
                quantity: quantityInput(
                    reorderQuantityOf(product),
                    product.unit,
                ),
                cost: '0.00',
            }));
            return true;
        }
        function take(): PurchaseOrderDraftLine[] {
            const result = owner.value === auth.user?.userId ? lines.value : [];
            owner.value = undefined;
            lines.value = [];
            return result;
        }
        return { prepare, take };
    },
);
