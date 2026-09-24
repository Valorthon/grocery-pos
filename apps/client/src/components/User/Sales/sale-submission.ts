import { ref } from 'vue';
import { isAxiosError } from 'axios';
import { type DiscountInput, ErrorCode } from '@grocery-pos/contracts';
import { drawerCashAmount } from './checkout';
import type { PaymentRequest, Receipt } from './types';

/** The ticket part of `POST /sales`: what is being sold, not how it is paid. */
export interface SaleTicket {
    sellDetails: { product: string; quantity: number }[];
    discount?: DiscountInput;
}

/** The full `POST /sales` body. */
export interface SaleRequest extends PaymentRequest, SaleTicket {
    idempotencyKey: string;
}

/**
 * A random v4 UUID. `crypto.randomUUID` only exists in secure contexts
 * (HTTPS or localhost), so a register opened over plain HTTP on the LAN
 * builds one from `getRandomValues`, which is always available.
 */
export function newIdempotencyKey(): string {
    const c = globalThis.crypto;
    if (typeof c.randomUUID === 'function') return c.randomUUID();

    const bytes = c.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
        '',
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The idempotency key of the ticket being checked out.
 *
 * One key per checkout attempt of a ticket: every retry of the same ticket
 * reuses it, so a sale the server already recorded is replayed rather than
 * charged again. A new key is made once the sale succeeds, or when the
 * ticket (lines, quantities, discount) changes. Changing only the payment
 * keeps the key: if the first try did commit, the server refuses the
 * different payment with a 409 instead of recording a second sale; if it
 * did not, the key is still unused and the new payment goes through.
 */
export function createCheckoutAttempt(generate = newIdempotencyKey) {
    let key: string | null = null;
    let ticketSignature: string | null = null;

    return {
        keyFor(ticket: SaleTicket): string {
            const signature = JSON.stringify(ticket);
            if (key === null || signature !== ticketSignature) {
                key = generate();
                ticketSignature = signature;
            }
            return key;
        },
        /** The sale went through: the next checkout gets a new key. */
        settle() {
            key = null;
            ticketSignature = null;
        },
    };
}

interface CartLike {
    lock(): void;
    unlock(): void;
    clear(): void;
}

/**
 * Sends `POST /sales` for the current ticket.
 *
 * While the request is in flight the cart is locked, so the ticket that is
 * charged is the ticket that is cleared. On success the drawer is credited
 * and the receipt shown from the server's response only; on failure the
 * cart is left as it was and the error is rethrown for the checkout modal
 * to show, with Retry reusing the same key.
 */
export function useSaleCheckout(deps: {
    cart: CartLike;
    ticket: () => SaleTicket;
    post: (body: SaleRequest) => Promise<Receipt>;
    recordCash: (centavos: number) => void;
    generateKey?: () => string;
}) {
    const attempt = createCheckoutAttempt(deps.generateKey);
    const inFlight = ref(false);

    async function submit(payment: PaymentRequest): Promise<Receipt> {
        if (inFlight.value) {
            throw new Error('This sale is already being recorded');
        }

        const ticket = deps.ticket();
        const body: SaleRequest = {
            ...payment,
            ...ticket,
            idempotencyKey: attempt.keyFor(ticket),
        };

        inFlight.value = true;
        deps.cart.lock();
        let receipt: Receipt;
        try {
            receipt = await deps.post(body);
        } finally {
            deps.cart.unlock();
            inFlight.value = false;
        }

        attempt.settle();
        // The server's cash tender net of change, not the modal's figures.
        deps.recordCash(drawerCashAmount(receipt));
        deps.cart.clear();
        return receipt;
    }

    return { submit, inFlight };
}

/** Why a `POST /sales` failed, worded for the cashier. */
export function saleErrorMessage(error: unknown): string {
    if (!isAxiosError(error)) {
        return error instanceof Error ? error.message : 'Sale failed';
    }

    const res = error.response;
    if (!res) {
        return 'No response from the server. The sale may already be recorded: Retry is safe and will not charge twice.';
    }

    const data = res.data as { message?: unknown; error?: unknown } | undefined;
    const message =
        typeof data?.message === 'string' && data.message
            ? data.message.replace(/\.$/, '')
            : 'Sale failed';

    if (data?.error === ErrorCode.SALE_IN_PROGRESS) return `${message}.`;
    if (res.status === 400) {
        return `${message}. Review the ticket and the total, then retry.`;
    }
    if (res.status >= 500) {
        return `${message}. Retry is safe and will not charge twice.`;
    }
    return `${message}.`;
}

/** True when the server refused the sale as invalid (nothing was recorded). */
export function isRejectedSale(error: unknown): boolean {
    return isAxiosError(error) && error.response?.status === 400;
}
