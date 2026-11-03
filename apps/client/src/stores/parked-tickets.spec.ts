import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { DiscountType } from '@grocery-pos/contracts';
import {
    CART_STORAGE_VERSION,
    PARKED_LABEL_MAX,
    PARKED_TICKETS_MAX,
    TICKET_AMOUNT_MAX,
    cartStorageKey,
    parseStoredCart,
    useCartStore,
} from './cart';
import { useUIStore } from './ui';

const MILK = {
    product: 'p1',
    EAN: '2000000000015',
    name: 'milk',
    unitPrice: 9500,
    quantity: 2,
};
let pinia = createPinia();
const otherTabs: ReturnType<typeof createPinia>[] = [];
beforeEach(() => {
    localStorage.clear();
    pinia = createPinia();
    setActivePinia(pinia);
});
afterEach(() => {
    disposePinia(pinia);
    for (const tab of otherTabs.splice(0)) disposePinia(tab);
});
function anotherTab() {
    const tab = createPinia();
    otherTabs.push(tab);
    const cart = useCartStore(tab);
    cart.setOwner('ana');
    return cart;
}
function savedCart() {
    return parseStoredCart(localStorage.getItem(cartStorageKey('ana')));
}
function start() {
    const cart = useCartStore();
    cart.setOwner('ana');
    cart.add(MILK, MILK.quantity);
    return cart;
}
function reload() {
    disposePinia(pinia);
    pinia = createPinia();
    setActivePinia(pinia);
    const cart = useCartStore();
    cart.setOwner('ana');
    return cart;
}
function resume(
    cart: ReturnType<typeof useCartStore>,
    id: string,
    items = [{ ...MILK, unitPrice: 10_000 }],
) {
    cart.resumeParked(
        id,
        items,
        JSON.stringify(cart.parked.find((t) => t.id === id)),
    );
}

describe('parked ticket durable moves (#35)', () => {
    it('keeps a draft another tab parks while this tab is checking out', () => {
        const cart = start();
        const checkoutAttempt = {
            idempotencyKey: 'sale-a',
            ticketSignature: 'milk',
        };
        cart.setAttempt(checkoutAttempt);
        cart.lock();

        const other = anotherTab();
        // The second cashier view explicitly clears the mirrored ticket,
        // then parks a different customer while the first sale is in flight.
        other.clear();
        other.add({ ...MILK, product: 'bread', name: 'bread' });
        const id = other.park('Customer B', 'shift1');
        cart.onStorage(
            new StorageEvent('storage', {
                key: cartStorageKey('ana'),
                newValue: localStorage.getItem(cartStorageKey('ana')),
            }),
        );
        expect(cart.items).toEqual([MILK]);
        expect(cart.attempt).toEqual(checkoutAttempt);

        cart.unlock();
        cart.clear();
        expect(cart.items).toEqual([]);
        expect(cart.attempt).toBeNull();
        expect(cart.parked.map((ticket) => ticket.id)).toEqual([id]);
        expect(savedCart()?.parked.map((ticket) => ticket.id)).toEqual([id]);
    });
    it('does not resurrect a draft discarded in another tab during checkout', () => {
        const cart = start();
        const id = cart.park('Already served', 'shift1');
        cart.add(MILK, MILK.quantity);
        cart.setAttempt({ idempotencyKey: 'sale-a', ticketSignature: 'milk' });
        cart.lock();
        const other = anotherTab();
        other.clear();
        other.discardParked(id);

        cart.unlock();
        cart.clear();
        expect(cart.parked).toEqual([]);
        expect(savedCart()).toBeNull();
    });
    it('keeps remote carry updates when an ordinary basket edit beats the storage event', () => {
        const cart = start();
        cart.park('Tomorrow', 'shift1');
        const other = anotherTab();
        other.finishParkedShift('carry');

        // Browsers deliver storage events asynchronously; this edit happens
        // before the first tab has received the carry operation's event.
        cart.add(MILK);
        expect(cart.parked[0].shiftId).toBeNull();
        expect(savedCart()?.parked[0].shiftId).toBeNull();
        expect(savedCart()?.items[0].product).toBe(MILK.product);
    });
    it('preserves new drafts on logout reset and keeps them private to the original cashier', () => {
        const cart = start();
        cart.lock();
        const other = anotherTab();
        other.clear();
        other.add(MILK);
        const id = other.park('Customer B', 'shift1');

        cart.reset();
        expect(savedCart()?.parked.map((ticket) => ticket.id)).toEqual([id]);
        cart.setOwner('ben');
        expect(cart.items).toEqual([]);
        expect(cart.parked).toEqual([]);
        cart.clear();
        expect(savedCart()?.parked.map((ticket) => ticket.id)).toEqual([id]);
        cart.setOwner('ana');
        expect(cart.parked.map((ticket) => ticket.id)).toEqual([id]);
    });
    it('does not overwrite unseen remote drafts when storage cannot be read', () => {
        const cart = start();
        const other = anotherTab();
        other.clear();
        other.add(MILK);
        other.park('Keep saved', 'shift1');
        const latest = localStorage.getItem(cartStorageKey('ana'));
        const getItem = vi
            .spyOn(Storage.prototype, 'getItem')
            .mockImplementation(() => {
                throw new Error('storage unavailable');
            });

        cart.clear();
        cart.reset();
        getItem.mockRestore();
        expect(localStorage.getItem(cartStorageKey('ana'))).toBe(latest);
    });
    it('parks the full basket and discount, completes another basket, then resumes with fresh prices', () => {
        const cart = start();
        cart.setDiscount({
            type: DiscountType.PERCENT,
            value: 5,
            reason: 'loyalty',
        });
        const id = cart.park('  Customer A  ', 'shift1');
        expect(cart.items).toEqual([]);
        expect(cart.discount).toBeNull();
        expect(cart.parked[0]).toMatchObject({
            id,
            label: 'Customer A',
            shiftId: 'shift1',
            items: [MILK],
        });
        cart.add({ ...MILK, product: 'p2' });
        cart.clear();
        const again = reload();
        expect(again.parked).toHaveLength(1);
        resume(again, id);
        expect(again.items).toEqual([{ ...MILK, unitPrice: 10_000 }]);
        expect(again.discount?.reason).toBe('loyalty');
        expect(again.attempt).toBeNull();
        expect(again.parked).toEqual([]);
        expect(reload().items).toEqual(again.items);
    });
    it('keeps drafts after logout for the original cashier only', () => {
        const cart = start();
        cart.park('', 'shift1');
        cart.reset();
        expect(cart.parked).toEqual([]);
        expect(cart.items).toEqual([]);
        cart.setOwner('ben');
        expect(cart.parked).toEqual([]);
        cart.setOwner('ana');
        expect(cart.parked[0].items).toEqual([MILK]);
    });
    it('never persists approval credentials or checkout attempts in parked drafts', () => {
        const cart = start();
        cart.park('', 'shift1');
        const raw = JSON.parse(
            localStorage.getItem(cartStorageKey('ana'))!,
        ) as { parked: Record<string, unknown>[] };
        expect(Object.keys(raw.parked[0]).sort()).toEqual(
            ['discount', 'id', 'items', 'label', 'parkedAt', 'shiftId'].sort(),
        );
    });
    it('refuses empty, ownerless, locked, over-limit or unresolved-checkout parking', () => {
        const cart = useCartStore();
        expect(() => cart.park('', 's')).toThrow(/Log in/);
        cart.setOwner('ana');
        expect(() => cart.park('', 's')).toThrow(/Add items/);
        cart.add(MILK);
        cart.lock();
        expect(() => cart.park('', 's')).toThrow(/Wait/);
        cart.unlock();
        cart.setAttempt({ idempotencyKey: 'sent', ticketSignature: 'same' });
        expect(() => cart.park('', 's')).toThrow(/may already be recorded/);
        expect(cart.items).toHaveLength(1);
        cart.setAttempt(null);
        expect(() => cart.park('x'.repeat(PARKED_LABEL_MAX + 1), 's')).toThrow(
            /too long/,
        );
        for (let n = 0; n < PARKED_TICKETS_MAX; n++) {
            cart.park('', 's');
            cart.add(MILK);
        }
        expect(() => cart.park('', 's')).toThrow(/At most/);
    });
    it('retains the active ticket when parking cannot write storage', () => {
        const cart = start();
        const saved = localStorage.getItem(cartStorageKey('ana'));
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        expect(() => cart.park('', 's')).toThrow(/Nothing was changed/);
        expect(cart.items).toEqual([MILK]);
        expect(cart.parked).toEqual([]);
        expect(localStorage.getItem(cartStorageKey('ana'))).toBe(saved);
    });
    it('retains the parked ticket when resuming cannot write storage', () => {
        const cart = start();
        const id = cart.park('', 's');
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        expect(() => resume(cart, id)).toThrow(/Nothing was changed/);
        expect(cart.parked).toHaveLength(1);
        expect(cart.items).toEqual([]);
    });
    it('will not replace an active basket or unresolved attempt', () => {
        const cart = start();
        const id = cart.park('', 's');
        cart.add(MILK);
        expect(() => resume(cart, id)).toThrow(/Park or clear/);
        cart.clear();
        cart.setAttempt({ idempotencyKey: 'pending', ticketSignature: 'same' });
        expect(() => resume(cart, id)).toThrow(/Park or clear/);
        expect(() => cart.discardParked(id)).toThrow(/retrying/);
        expect(() => cart.finishParkedShift('carry')).toThrow(/retrying/);
    });
    it.each([
        'missing',
        'partial',
        'wrong quantity',
        'invalid price',
        'over cap',
    ])('rejects %s repricing without losing the parked ticket', (kind) => {
        const cart = start();
        const id = cart.park('', 's');
        if (kind === 'missing') {
            expect(() => cart.resumeParked('unknown', [MILK], '{}')).toThrow(
                /changed/,
            );
        } else {
            const items =
                kind === 'partial'
                    ? []
                    : [
                          {
                              ...MILK,
                              quantity:
                                  kind === 'wrong quantity' ? 1 : MILK.quantity,
                              unitPrice:
                                  kind === 'invalid price'
                                      ? -1
                                      : kind === 'over cap'
                                        ? TICKET_AMOUNT_MAX
                                        : MILK.unitPrice,
                          },
                      ];
            expect(() => resume(cart, id, items)).toThrow(/cannot be resumed/);
        }
        expect(cart.items).toEqual([]);
        expect(cart.parked[0].items).toEqual([MILK]);
    });
    it('refuses async resume if another tab changed the parked ticket or active cart', () => {
        const cart = start();
        const id = cart.park('', 's');
        const expected = JSON.stringify(cart.parked[0]);
        const raw = JSON.parse(
            localStorage.getItem(cartStorageKey('ana'))!,
        ) as { items: (typeof MILK)[] };
        raw.items = [MILK];
        localStorage.setItem(cartStorageKey('ana'), JSON.stringify(raw));
        expect(() => cart.resumeParked(id, [MILK], expected)).toThrow(
            /another tab/,
        );
        expect(cart.items).toEqual([MILK]);
        expect(cart.parked).toHaveLength(1);
    });
    it('refuses a changed parked snapshot, without discarding it', () => {
        const cart = start();
        const id = cart.park('', 's');
        expect(() => cart.resumeParked(id, [MILK], 'old')).toThrow(/changed/);
        expect(cart.parked).toHaveLength(1);
    });
    it('discards a selected draft and keeps the current ticket and other drafts', () => {
        const cart = start();
        const first = cart.park('', 's');
        cart.add(MILK);
        const second = cart.park('', 's');
        cart.add(MILK);
        cart.discardParked(first);
        expect(cart.parked.map((t) => t.id)).toEqual([second]);
        expect(cart.items).toHaveLength(1);
        expect(reload().parked.map((t) => t.id)).toEqual([second]);
    });
    it.each(['carry', 'discard'] as const)(
        'explicitly applies shift close choice %s',
        (choice) => {
            const cart = start();
            cart.park('', 's');
            cart.finishParkedShift(choice);
            const again = reload();
            expect(again.parked).toHaveLength(choice === 'carry' ? 1 : 0);
            if (choice === 'carry') expect(again.parked[0].shiftId).toBeNull();
        },
    );
    it('syncs parked updates from another tab without echoing them', () => {
        const cart = start();
        cart.park('', 's');
        const saved = localStorage.getItem(cartStorageKey('ana'));
        cart.onStorage(
            new StorageEvent('storage', {
                key: cartStorageKey('ana'),
                newValue: saved,
            }),
        );
        expect(cart.remoteChanges).toBe(1);
        expect(cart.parked).toHaveLength(1);
    });
    it('keeps ordinary version-1 baskets compatible and reports malformed parked drafts', () => {
        const valid = start();
        valid.park('', 's');
        const draft = valid.parked[0];
        const raw = {
            version: CART_STORAGE_VERSION,
            items: [],
            discount: null,
            attempt: null,
            parked: [
                draft,
                draft,
                { ...draft, id: 'bad', items: [{ ...MILK, quantity: 0 }] },
                { ...draft, id: 'bad2', parkedAt: 'bad' },
                { ...draft, id: 'bad3', label: null },
                { ...draft, id: 'bad4', shiftId: 4 },
                null,
            ],
        };
        const parsed = parseStoredCart(JSON.stringify(raw));
        expect(parsed?.parked).toHaveLength(1);
        expect(parsed?.droppedParked).toBe(6);
        localStorage.setItem(cartStorageKey('ana'), JSON.stringify(raw));
        const again = reload();
        expect(again.parked).toHaveLength(1);
        expect(
            useUIStore().toasts.some((toast) =>
                toast.lines.join(' ').includes('parked tickets'),
            ),
        ).toBe(true);
    });
});
