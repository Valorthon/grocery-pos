import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { DiscountType } from '@grocery-pos/contracts';
import {
    CART_STORAGE_VERSION,
    TICKET_AMOUNT_MAX,
    cartStorageKey,
    parseStoredCart,
    useCartStore,
} from './cart';

const MILK = {
    product: 'p1',
    EAN: '2000000000015',
    name: 'milk',
    unitPrice: 9500,
};
const MINTS = {
    product: 'p2',
    EAN: '2000000000022',
    name: 'mints',
    unitPrice: 2500,
};
const BREAD = {
    product: 'p3',
    EAN: '2000000000039',
    name: 'bread',
    unitPrice: 6000,
};

function stored(userId: string): unknown {
    const json = localStorage.getItem(cartStorageKey(userId));
    return json === null ? null : JSON.parse(json);
}

beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
});

// Each store listens for other tabs' storage events: stop them between tests.
afterEach(() => {
    useCartStore(getActivePinia()).$dispose();
});

describe('cart subtotal', () => {
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

describe('cart setQuantity (#23)', () => {
    it('sets a whole number of at least 1', () => {
        const cart = useCartStore();
        cart.add(MILK);
        expect(cart.setQuantity('p1', 12)).toBe(true);
        expect(cart.items[0].quantity).toBe(12);
    });

    it.each([
        ['zero', 0],
        ['a negative number', -2],
        ['a fraction', 1.5],
        ['NaN', Number.NaN],
        ['an unsafe integer', 2 ** 60],
    ])('refuses %s and keeps the line as it was', (_, quantity) => {
        const cart = useCartStore();
        cart.add(MILK, 3);
        expect(cart.setQuantity('p1', quantity)).toBe(false);
        expect(cart.items).toEqual([{ ...MILK, quantity: 3 }]);
    });

    it('does nothing for a product not on the ticket, or while locked', () => {
        const cart = useCartStore();
        cart.add(MILK);
        expect(cart.setQuantity('nope', 2)).toBe(false);
        cart.lock();
        expect(cart.setQuantity('p1', 2)).toBe(false);
        expect(cart.items[0].quantity).toBe(1);
    });

    it('never adds an invalid quantity', () => {
        const cart = useCartStore();
        cart.add(MILK, 0);
        cart.add(MILK, 1.5);
        expect(cart.items).toEqual([]);
    });
});

describe('cart remove and restore (#23)', () => {
    it('puts a removed line back at its position with its quantity', () => {
        const cart = useCartStore();
        cart.add(MILK);
        cart.add(MINTS, 4);
        cart.add(BREAD);

        const removed = cart.remove('p2')!;
        expect(removed).toEqual({ item: { ...MINTS, quantity: 4 }, index: 1 });
        expect(cart.items.map((i) => i.name)).toEqual(['milk', 'bread']);

        expect(cart.restore(removed.item, removed.index)).toBe(true);
        expect(cart.items.map((i) => `${i.quantity}x ${i.name}`)).toEqual([
            '1x milk',
            '4x mints',
            '1x bread',
        ]);
    });

    it('does not restore a product that is on the ticket again', () => {
        const cart = useCartStore();
        cart.add(MILK);
        const removed = cart.remove('p1')!;
        cart.add(MILK, 2);
        expect(cart.restore(removed.item, removed.index)).toBe(false);
        expect(cart.items).toEqual([{ ...MILK, quantity: 2 }]);
    });
});

describe('the saved basket (#23, decision 2026-09-25)', () => {
    it('is saved under the cashier and comes back for that cashier', () => {
        const cart = useCartStore();
        cart.setOwner('ana');
        cart.add(MILK, 2);
        cart.add(MINTS);
        cart.setDiscount({
            type: DiscountType.FIXED,
            value: 1500,
            reason: 'loyalty',
        });

        expect(stored('ana')).toEqual({
            version: CART_STORAGE_VERSION,
            items: [
                { ...MILK, quantity: 2 },
                { ...MINTS, quantity: 1 },
            ],
            discount: {
                type: DiscountType.FIXED,
                value: 1500,
                reason: 'loyalty',
            },
            attempt: null,
        });

        // A refresh: a new app, the same cashier.
        setActivePinia(createPinia());
        const again = useCartStore();
        again.setOwner('ana');
        expect(again.items).toEqual([
            { ...MILK, quantity: 2 },
            { ...MINTS, quantity: 1 },
        ]);
        expect(again.discount).toEqual({
            type: DiscountType.FIXED,
            value: 1500,
            reason: 'loyalty',
        });
    });

    it('is never shown to another cashier', () => {
        const cart = useCartStore();
        cart.setOwner('ana');
        cart.add(MILK);

        setActivePinia(createPinia());
        const other = useCartStore();
        other.setOwner('ben');
        expect(other.items).toEqual([]);
        expect(other.discount).toBeNull();
        // ...and ana's is left alone.
        expect(stored('ana')).not.toBeNull();
        expect(stored('ben')).toBeNull();
    });

    it('switching cashiers in the same app swaps the basket', () => {
        const cart = useCartStore();
        cart.setOwner('ana');
        cart.add(MILK);
        cart.setOwner('ben');
        expect(cart.items).toEqual([]);
        cart.add(MINTS);
        cart.setOwner('ana');
        expect(cart.items.map((i) => i.name)).toEqual(['milk']);
    });

    it('is not saved without a cashier', () => {
        const cart = useCartStore();
        cart.add(MILK);
        expect(localStorage.length).toBe(0);
    });

    it('is removed on a completed sale or a void (clear)', () => {
        const cart = useCartStore();
        cart.setOwner('ana');
        cart.add(MILK);
        cart.setDiscount({
            type: DiscountType.PERCENT,
            value: 10,
            reason: 'x',
        });
        cart.clear();
        expect(cart.items).toEqual([]);
        expect(cart.discount).toBeNull();
        expect(stored('ana')).toBeNull();
    });

    it('is removed on logout (reset), even mid-checkout', () => {
        const cart = useCartStore();
        cart.setOwner('ana');
        cart.add(MILK);
        cart.lock();
        cart.reset();
        expect(cart.items).toEqual([]);
        expect(cart.owner).toBeNull();
        expect(stored('ana')).toBeNull();
        // Nothing is saved after the reset either.
        cart.add(MINTS);
        expect(localStorage.length).toBe(0);
    });

    it('keeps the discount when the lines empty', () => {
        const cart = useCartStore();
        cart.setOwner('ana');
        cart.add(MILK);
        cart.setDiscount({ type: DiscountType.PERCENT, value: 5, reason: 'x' });
        cart.remove('p1');
        expect(stored('ana')).toMatchObject({
            items: [],
            discount: { value: 5 },
        });
    });

    describe('malformed storage', () => {
        function load(json: string) {
            localStorage.setItem(cartStorageKey('ana'), json);
            const cart = useCartStore();
            cart.setOwner('ana');
            return cart;
        }

        it.each([
            ['not JSON', '{oops'],
            [
                'another version',
                JSON.stringify({
                    version: 2,
                    items: [{ ...MILK, quantity: 1 }],
                    discount: null,
                }),
            ],
            [
                'no version',
                JSON.stringify({ items: [{ ...MILK, quantity: 1 }] }),
            ],
            ['items not a list', JSON.stringify({ version: 1, items: 'milk' })],
            ['a list', JSON.stringify([MILK])],
        ])('ignores %s and starts empty', (_, json) => {
            const cart = load(json);
            expect(cart.items).toEqual([]);
            expect(cart.discount).toBeNull();
            // The unreadable entry is dropped.
            expect(stored('ana')).toBeNull();
        });

        it('drops malformed lines and keeps the good ones', () => {
            const cart = load(
                JSON.stringify({
                    version: 1,
                    items: [
                        { ...MILK, quantity: 2 },
                        { ...MINTS, quantity: 0 },
                        { ...BREAD, unitPrice: '60' },
                        { ...BREAD, quantity: 1.5 },
                        {
                            product: 'p4',
                            name: 'no EAN',
                            unitPrice: 1,
                            quantity: 1,
                        },
                        null,
                        { ...MILK, quantity: 9 },
                        { ...MINTS, quantity: 1, extra: '<script>' },
                    ],
                    discount: null,
                }),
            );
            expect(cart.items).toEqual([
                { ...MILK, quantity: 2 },
                { ...MINTS, quantity: 1 },
            ]);
        });

        it.each([
            ['an unknown type', { type: 'BOGO', value: 5, reason: '' }],
            [
                'a percent over 100',
                { type: DiscountType.PERCENT, value: 150, reason: '' },
            ],
            [
                'a fraction',
                { type: DiscountType.FIXED, value: 1.5, reason: '' },
            ],
            [
                'a negative amount',
                { type: DiscountType.FIXED, value: -1, reason: '' },
            ],
            ['no reason', { type: DiscountType.PERCENT, value: 5 }],
            [
                'a reason too long',
                {
                    type: DiscountType.PERCENT,
                    value: 5,
                    reason: 'x'.repeat(101),
                },
            ],
        ])('drops a discount with %s', (_, discount) => {
            const cart = load(
                JSON.stringify({
                    version: 1,
                    items: [{ ...MILK, quantity: 1 }],
                    discount,
                }),
            );
            expect(cart.items).toHaveLength(1);
            expect(cart.discount).toBeNull();
        });

        it('parses nothing from null', () => {
            expect(parseStoredCart(null)).toBeNull();
        });
    });
});

describe('the saved checkout attempt (#23 review)', () => {
    const ATTEMPT = { idempotencyKey: 'key-1', ticketSignature: '{"x":1}' };

    it('is saved with the basket and comes back with it', () => {
        const cart = useCartStore();
        cart.setOwner('ana');
        cart.add(MILK);
        cart.setAttempt(ATTEMPT);
        expect(stored('ana')).toMatchObject({ attempt: ATTEMPT });

        setActivePinia(createPinia());
        const again = useCartStore();
        again.setOwner('ana');
        expect(again.attempt).toEqual(ATTEMPT);
    });

    it('is cleared on a sale or a void (clear) and on logout (reset)', () => {
        const cart = useCartStore();
        cart.setOwner('ana');
        cart.add(MILK);
        cart.setAttempt(ATTEMPT);
        cart.clear();
        expect(cart.attempt).toBeNull();
        expect(stored('ana')).toBeNull();

        cart.add(MILK);
        cart.setAttempt(ATTEMPT);
        cart.reset();
        expect(cart.attempt).toBeNull();
        expect(stored('ana')).toBeNull();
    });

    it('drops a malformed attempt', () => {
        localStorage.setItem(
            cartStorageKey('ana'),
            JSON.stringify({
                version: 1,
                items: [{ ...MILK, quantity: 1 }],
                discount: null,
                attempt: { idempotencyKey: 42, ticketSignature: '' },
            }),
        );
        const cart = useCartStore();
        cart.setOwner('ana');
        expect(cart.items).toHaveLength(1);
        expect(cart.attempt).toBeNull();
    });
});

describe('ticket amount cap (#23 review)', () => {
    it('refuses an add or a quantity that would take the ticket past AMOUNT_MAX', () => {
        const cart = useCartStore();
        expect(cart.add(MILK, 1)).toBe(true);
        const max = cart.maxQuantity('p1', MILK.unitPrice);
        expect(max).toBe(Math.floor(TICKET_AMOUNT_MAX / MILK.unitPrice));

        expect(cart.add(MILK, max)).toBe(false);
        expect(cart.add(MILK, max - 1)).toBe(true);
        expect(cart.items[0].quantity).toBe(max);
        expect(cart.subtotal).toBeLessThanOrEqual(TICKET_AMOUNT_MAX);

        expect(cart.add(MINTS, 1)).toBe(false);
        expect(cart.setQuantity('p1', max + 1)).toBe(false);
        expect(cart.setQuantity('p1', 2)).toBe(true);
    });

    it('refuses an unsafe multiplier outright', () => {
        const cart = useCartStore();
        expect(cart.add(MILK, 1e20)).toBe(false);
        expect(cart.items).toEqual([]);
    });
});

describe('another tab (#23 review)', () => {
    function storageEvent(key: string | null, newValue: string | null) {
        return new StorageEvent('storage', { key, newValue });
    }

    it('follows another tab signing a different cashier in', () => {
        const cart = useCartStore();
        cart.setOwner('ana');
        cart.add(MILK);

        localStorage.setItem(
            'user',
            JSON.stringify({ userId: 'ben', username: 'ben', roles: [] }),
        );
        window.dispatchEvent(
            storageEvent('user', localStorage.getItem('user')),
        );

        expect(cart.owner).toBe('ben');
        expect(cart.items).toEqual([]);
        // Ana's basket is not touched, and nothing of hers goes under Ben.
        expect(stored('ana')).not.toBeNull();
        cart.add(MINTS);
        expect(stored('ben')).toMatchObject({ items: [{ product: 'p2' }] });
        expect(stored('ana')).toMatchObject({ items: [{ product: 'p1' }] });
    });

    it('stops saving when another tab signs out', () => {
        const cart = useCartStore();
        cart.setOwner('ana');
        cart.add(MILK);
        // The other tab's logout removed the user and the basket.
        localStorage.clear();
        window.dispatchEvent(storageEvent('user', null));

        expect(cart.owner).toBeNull();
        expect(cart.items).toEqual([]);
        cart.add(MINTS);
        expect(localStorage.length).toBe(0);
    });

    it('takes a sale or void in another tab without writing the old basket back', () => {
        const cart = useCartStore();
        cart.setOwner('ana');
        cart.add(MILK);
        localStorage.removeItem(cartStorageKey('ana'));

        window.dispatchEvent(storageEvent(cartStorageKey('ana'), null));

        expect(cart.items).toEqual([]);
        expect(stored('ana')).toBeNull();
    });

    it('shows the basket another tab of the same cashier saved', () => {
        const cart = useCartStore();
        cart.setOwner('ana');
        const json = JSON.stringify({
            version: 1,
            items: [{ ...MINTS, quantity: 3 }],
            discount: null,
            attempt: null,
        });
        localStorage.setItem(cartStorageKey('ana'), json);
        window.dispatchEvent(storageEvent(cartStorageKey('ana'), json));
        expect(cart.items).toEqual([{ ...MINTS, quantity: 3 }]);
    });

    it('ignores other keys, and leaves a ticket being charged alone', () => {
        const cart = useCartStore();
        cart.setOwner('ana');
        cart.add(MILK);
        window.dispatchEvent(storageEvent(cartStorageKey('ben'), null));
        expect(cart.items).toHaveLength(1);

        cart.lock();
        window.dispatchEvent(storageEvent(cartStorageKey('ana'), null));
        expect(cart.items).toHaveLength(1);
    });
});
