import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useCartStore } from './cart';

describe('cart subtotal', () => {
    beforeEach(() => setActivePinia(createPinia()));

    it('is an exact integer number of centavos', () => {
        const cart = useCartStore();

        cart.add(
            { product: 'p1', EAN: '1', name: 'bread', unitPrice: 1999 },
            3,
        );
        cart.add({ product: 'p2', EAN: '2', name: 'milk', unitPrice: 10 }, 7);

        // As pesos in doubles, the ₱0.10 x 7 line alone is 0.7000000000000001.
        expect(cart.subtotal).toBe(6067);
    });
});
