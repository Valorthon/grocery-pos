import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

export interface CartItem {
    product: string;
    EAN: string;
    name: string;
    /** Centavos. */
    unitPrice: number;
    quantity: number;
}

export const useCartStore = defineStore('cart', () => {
    const items = ref<CartItem[]>([]);
    /**
     * True while `POST /sales` is in flight. The ticket being charged must
     * not change under the request: every edit below is ignored until the
     * response lands, so a scan cannot be cleared unsold by the success path.
     */
    const locked = ref(false);

    const totalUnits = computed(() =>
        items.value.reduce((sum, item) => sum + item.quantity, 0),
    );

    const subtotal = computed(() =>
        items.value.reduce(
            (sum, item) => sum + item.unitPrice * item.quantity,
            0,
        ),
    );

    function add(
        product: {
            product: string;
            EAN: string;
            name: string;
            unitPrice: number;
        },
        quantity = 1,
    ) {
        if (locked.value) return;
        const existing = items.value.find((c) => c.product === product.product);
        if (existing) {
            existing.quantity += quantity;
        } else {
            items.value.push({ ...product, quantity });
        }
    }

    function setQuantity(productId: string, quantity: number) {
        if (locked.value) return;
        if (quantity <= 0) {
            remove(productId);
            return;
        }
        const item = items.value.find((c) => c.product === productId);
        if (item) item.quantity = quantity;
    }

    function remove(productId: string) {
        if (locked.value) return;
        items.value = items.value.filter((c) => c.product !== productId);
    }

    function clear() {
        if (locked.value) return;
        items.value = [];
    }

    /** Updates the unit price (centavos) of the lines in `prices`. */
    function setUnitPrices(prices: Map<string, number>) {
        if (locked.value) return;
        for (const item of items.value) {
            const price = prices.get(item.product);
            if (price !== undefined) item.unitPrice = price;
        }
    }

    function lock() {
        locked.value = true;
    }

    function unlock() {
        locked.value = false;
    }

    return {
        items,
        locked,
        totalUnits,
        subtotal,
        add,
        setQuantity,
        remove,
        clear,
        setUnitPrices,
        lock,
        unlock,
    };
});
