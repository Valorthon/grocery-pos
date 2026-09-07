import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

export interface CartItem {
    product: string;
    EAN: string;
    name: string;
    unitPrice: number;
    quantity: number;
}

export const useCartStore = defineStore('cart', () => {
    const items = ref<CartItem[]>([]);

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
        const existing = items.value.find((c) => c.product === product.product);
        if (existing) {
            existing.quantity += quantity;
        } else {
            items.value.push({ ...product, quantity });
        }
    }

    function setQuantity(productId: string, quantity: number) {
        if (quantity <= 0) {
            remove(productId);
            return;
        }
        const item = items.value.find((c) => c.product === productId);
        if (item) item.quantity = quantity;
    }

    function remove(productId: string) {
        items.value = items.value.filter((c) => c.product !== productId);
    }

    function clear() {
        items.value = [];
    }

    return { items, totalUnits, subtotal, add, setQuantity, remove, clear };
});
