import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { AxiosError, AxiosHeaders } from 'axios';
import {
    DiscountType,
    ErrorCode,
    PaymentType,
    SaleStatus,
    TenderType,
} from '@grocery-pos/contracts';
import { useCartStore } from '@/stores/cart';
import {
    createCheckoutAttempt,
    newIdempotencyKey,
    saleErrorMessage,
    type SaleRequest,
    useSaleCheckout,
} from './sale-submission';
import type { PaymentRequest, Receipt } from './types';

const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const CASH_PAYMENT: PaymentRequest = {
    paymentType: PaymentType.CASH,
    tenders: [{ type: TenderType.CASH, amount: 50000 }],
};

function receiptFor(overrides: Partial<Receipt> = {}): Receipt {
    return {
        _id: 'sale1',
        createdAt: '2026-09-24T02:00:00.000Z',
        status: SaleStatus.COMPLETED,
        paymentType: PaymentType.CASH,
        referenceNumber: null,
        tenders: [{ type: TenderType.CASH, amount: 50000 }],
        amountTendered: 50000,
        changeGiven: 5000,
        cashierName: 'admin',
        items: [{ productName: 'bread', quantity: 2, amount: 45000 }],
        subtotal: 45000,
        discount: null,
        totalAmount: 45000,
        ...overrides,
    };
}

function httpError(status: number | null, data?: unknown) {
    const config = { headers: new AxiosHeaders() };
    return new AxiosError(
        'Request failed',
        status ? 'ERR_BAD_RESPONSE' : 'ECONNABORTED',
        config,
        undefined,
        status
            ? {
                  status,
                  statusText: '',
                  data,
                  headers: {},
                  config,
              }
            : undefined,
    );
}

describe('newIdempotencyKey', () => {
    it('is a v4 UUID, also without crypto.randomUUID (plain-HTTP LAN)', () => {
        expect(newIdempotencyKey()).toMatch(UUID);

        const original = globalThis.crypto.randomUUID;
        Object.defineProperty(globalThis.crypto, 'randomUUID', {
            value: undefined,
            configurable: true,
        });
        try {
            const a = newIdempotencyKey();
            const b = newIdempotencyKey();
            expect(a).toMatch(UUID);
            expect(a).not.toBe(b);
        } finally {
            Object.defineProperty(globalThis.crypto, 'randomUUID', {
                value: original,
                configurable: true,
            });
        }
    });
});

describe('createCheckoutAttempt', () => {
    const ticket = { sellDetails: [{ product: 'p1', quantity: 2 }] };
    let n: number;
    const generate = () => `key-${++n}`;

    beforeEach(() => {
        n = 0;
    });

    it('keeps the key across retries of the same ticket', () => {
        const attempt = createCheckoutAttempt(generate);

        expect(attempt.keyFor(ticket)).toBe('key-1');
        expect(attempt.keyFor({ ...ticket })).toBe('key-1');
    });

    it('makes a new key after a successful sale', () => {
        const attempt = createCheckoutAttempt(generate);
        attempt.keyFor(ticket);

        attempt.settle();

        expect(attempt.keyFor(ticket)).toBe('key-2');
    });

    it.each([
        ['a quantity', { sellDetails: [{ product: 'p1', quantity: 3 }] }],
        [
            'a line',
            {
                sellDetails: [
                    { product: 'p1', quantity: 2 },
                    { product: 'p2', quantity: 1 },
                ],
            },
        ],
        [
            'the discount',
            {
                ...ticket,
                discount: {
                    type: DiscountType.PERCENT,
                    value: 10,
                    reason: 'loyalty',
                },
            },
        ],
    ])('makes a new key when %s changes', (_, changed) => {
        const attempt = createCheckoutAttempt(generate);
        attempt.keyFor(ticket);

        expect(attempt.keyFor(changed)).toBe('key-2');
    });
});

describe('useSaleCheckout', () => {
    beforeEach(() => setActivePinia(createPinia()));

    function setup(post: (body: SaleRequest) => Promise<Receipt>) {
        const cart = useCartStore();
        cart.add(
            { product: 'p1', EAN: '1', name: 'bread', unitPrice: 22500 },
            2,
        );
        const recordCash = vi.fn();
        const postSpy = vi.fn(post);
        const checkout = useSaleCheckout({
            cart,
            ticket: () => ({
                sellDetails: cart.items.map(({ product, quantity }) => ({
                    product,
                    quantity,
                })),
            }),
            post: postSpy,
            recordCash,
        });
        return { cart, recordCash, post: postSpy, checkout };
    }

    it('reuses the key on a retry and makes a new one after success', async () => {
        let calls = 0;
        const { post, checkout, cart } = setup(() =>
            ++calls === 1
                ? Promise.reject(httpError(null))
                : Promise.resolve(receiptFor()),
        );

        await expect(checkout.submit(CASH_PAYMENT)).rejects.toThrow();
        await checkout.submit(CASH_PAYMENT);

        const [first, retry] = post.mock.calls.map(([body]) => body);
        expect(first.idempotencyKey).toMatch(UUID);
        expect(retry.idempotencyKey).toBe(first.idempotencyKey);
        expect(retry).toEqual(first);

        cart.add({ product: 'p1', EAN: '1', name: 'bread', unitPrice: 22500 });
        post.mockResolvedValueOnce(receiptFor({ _id: 'sale2' }));
        await checkout.submit(CASH_PAYMENT);
        expect(post.mock.calls[2][0].idempotencyKey).not.toBe(
            first.idempotencyKey,
        );
    });

    it('makes a new key when the cart changes after a failure', async () => {
        const { post, checkout, cart } = setup(() =>
            Promise.reject(httpError(400, { message: 'Insufficient stock' })),
        );

        await expect(checkout.submit(CASH_PAYMENT)).rejects.toThrow();
        cart.setQuantity('p1', 1);
        await expect(checkout.submit(CASH_PAYMENT)).rejects.toThrow();

        const [first, second] = post.mock.calls.map(([body]) => body);
        expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
        expect(second.sellDetails).toEqual([{ product: 'p1', quantity: 1 }]);
    });

    it('locks the cart while the request is in flight', async () => {
        let respond!: (r: Receipt) => void;
        const { cart, checkout } = setup(
            () => new Promise<Receipt>((resolve) => (respond = resolve)),
        );

        const pending = checkout.submit(CASH_PAYMENT);

        expect(cart.locked).toBe(true);
        expect(checkout.inFlight.value).toBe(true);
        // A scan, a quantity edit and a removal during the request are all
        // ignored: the ticket charged is the ticket cleared.
        cart.add({ product: 'p2', EAN: '2', name: 'milk', unitPrice: 100 });
        cart.setQuantity('p1', 5);
        cart.remove('p1');
        cart.clear();
        expect(cart.items).toEqual([
            expect.objectContaining({ product: 'p1', quantity: 2 }),
        ]);
        // A second confirm while in flight does not send a second request.
        await expect(checkout.submit(CASH_PAYMENT)).rejects.toThrow();

        respond(receiptFor());
        await pending;

        expect(cart.locked).toBe(false);
        expect(cart.items).toEqual([]);
    });

    it('unlocks and keeps the cart when the sale fails', async () => {
        const { cart, checkout, recordCash } = setup(() =>
            Promise.reject(httpError(500, { message: 'Database error' })),
        );

        await expect(checkout.submit(CASH_PAYMENT)).rejects.toThrow();

        expect(cart.locked).toBe(false);
        expect(cart.items).toHaveLength(1);
        expect(recordCash).not.toHaveBeenCalled();
    });

    it('takes the receipt and the drawer cash from the server response', async () => {
        // The server's figures differ from what the modal sent: the modal
        // tendered ₱500, the server recorded ₱500 cash less ₱77 change.
        const response = receiptFor({
            _id: 'from-server',
            changeGiven: 7700,
            totalAmount: 42300,
        });
        const { checkout, recordCash } = setup(() => Promise.resolve(response));

        const receipt = await checkout.submit(CASH_PAYMENT);

        expect(receipt).toBe(response);
        expect(recordCash).toHaveBeenCalledWith(50000 - 7700);
    });
});

describe('saleErrorMessage', () => {
    it('shows the server message and asks to review a rejected sale', () => {
        expect(
            saleErrorMessage(
                httpError(400, {
                    message: 'The tendered amount does not cover the total',
                }),
            ),
        ).toBe(
            'The tendered amount does not cover the total. Review the ticket and the total, then retry.',
        );
    });

    it('says a retry is safe when no response arrived', () => {
        expect(saleErrorMessage(httpError(null))).toMatch(
            /Retry is safe and will not charge twice/,
        );
    });

    it('passes a key conflict through as the server words it', () => {
        expect(
            saleErrorMessage(
                httpError(409, {
                    error: ErrorCode.SALE_IN_PROGRESS,
                    message:
                        'This sale is already being recorded. Retry in a moment.',
                }),
            ),
        ).toBe('This sale is already being recorded. Retry in a moment.');
    });
});
