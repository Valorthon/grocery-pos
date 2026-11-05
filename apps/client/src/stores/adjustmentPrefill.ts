import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { InventoryBatchView } from '@grocery-pos/contracts';
import type { AddForm } from '@/components/User/Adjustments/dto';
import { useAuthStore } from './auth';
/** One terminal-local handoff; never writes stock and never survives account changes. */
export const useAdjustmentPrefillStore = defineStore(
    'adjustment-prefill',
    () => {
        const auth = useAuthStore();
        const owner = ref<string>();
        const line = ref<AddForm>();
        watch(
            () => auth.user?.userId,
            () => {
                owner.value = undefined;
                line.value = undefined;
            },
            { flush: 'sync' },
        );
        function prepare(batch: InventoryBatchView): boolean {
            if (!auth.user?.userId || batch.remainingQty <= 0) return false;
            owner.value = auth.user.userId;
            line.value = {
                product: batch.product._id,
                batch: batch._id,
                EAN: batch.product.EAN,
                name: batch.product.name,
                unit: batch.product.unit,
                change: -batch.remainingQty,
                reason: `Write off batch ${batch.batchNo || batch._id.slice(-8)} (expiry ${batch.expiryDate || 'unknown'})`,
            };
            return true;
        }
        function take() {
            const result =
                owner.value === auth.user?.userId ? line.value : undefined;
            owner.value = undefined;
            line.value = undefined;
            return result;
        }
        return { prepare, take };
    },
);
