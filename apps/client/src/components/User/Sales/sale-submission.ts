import { ref } from 'vue';
import { isAxiosError } from 'axios';
import {
    type AppErrorResponse,
    type DiscountInput,
    ErrorCode,
    type Receipt,
    SaleStatus,
} from '@grocery-pos/contracts';
import { apiErrorBody, apiErrorCode } from '@/utils/api-error';
import type { PaymentRequest } from './types';

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
export function createCheckoutAttempt(
    generate = newIdempotencyKey,
    store: AttemptStore = memoryAttemptStore(),
) {
    return {
        keyFor(ticket: SaleTicket): string {
            const signature = JSON.stringify(ticket);
            const current = store.get();
            if (current && current.ticketSignature === signature) {
                return current.idempotencyKey;
            }
            const idempotencyKey = generate();
            store.set({ idempotencyKey, ticketSignature: signature });
            return idempotencyKey;
        },
        /** The sale went through: the next checkout gets a new key. */
        settle() {
            store.set(null);
        },
    };
}

/**
 * The checkout attempt in progress: the key a ticket was (or is being)
 * sent with, and that ticket's signature.
 */
export interface CheckoutAttempt {
    idempotencyKey: string;
    ticketSignature: string;
}

/**
 * Where the attempt is kept. The register keeps it in the cart store, which
 * saves it with the basket (#23 review): after a refresh or crash mid-sale
 * the same ticket is retried with the same key, so the server replays the
 * sale it already recorded instead of charging it again.
 */
export interface AttemptStore {
    get(): CheckoutAttempt | null;
    set(attempt: CheckoutAttempt | null): void;
}

function memoryAttemptStore(): AttemptStore {
    let attempt: CheckoutAttempt | null = null;
    return {
        get: () => attempt,
        set: (next) => {
            attempt = next;
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
 * charged is the ticket that is cleared. On success the receipt is shown
 * from the server's response only (the server also credits the shift's
 * drawer, issue #2); on failure the cart is left as it was and the error is
 * rethrown for the checkout modal to show, with Retry reusing the same key.
 *
 * Two answers settle the ticket without being a fresh sale:
 * - 409 SALE_003 with a stored receipt: the first try did commit (its
 *   response was lost) and the retry was tendered differently. The stored
 *   sale stands, with its original payment; it is returned as
 *   `alreadyRecorded` so change is settled from its tenders, not the ones
 *   just typed.
 * - A replayed sale that is no longer COMPLETED (voided or refunded since):
 *   the ticket is not cleared. The key is dropped,
 *   so confirming again rings the ticket up as a new sale, and a
 *   `SaleNotCompletedError` explains why.
 */
export function useSaleCheckout(deps: {
    cart: CartLike;
    ticket: () => SaleTicket;
    post: (body: SaleRequest) => Promise<Receipt>;
    generateKey?: () => string;
    /** Keeps the attempt across reloads; in memory when absent. */
    attemptStore?: AttemptStore;
}) {
    const attempt = createCheckoutAttempt(deps.generateKey, deps.attemptStore);
    const inFlight = ref(false);

    async function submit(payment: PaymentRequest): Promise<SaleOutcome> {
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
        let alreadyRecorded = false;
        try {
            receipt = await deps.post(body);
        } catch (error) {
            const stored = recordedReceipt(error);
            if (!stored) throw error;
            receipt = stored;
            alreadyRecorded = true;
        } finally {
            deps.cart.unlock();
            inFlight.value = false;
        }

        attempt.settle();

        if (receipt.status !== SaleStatus.COMPLETED) {
            throw new SaleNotCompletedError(receipt);
        }

        deps.cart.clear();
        return { receipt, alreadyRecorded };
    }

    return {
        submit,
        inFlight,
        /** Drops the ticket's key, e.g. when the ticket is voided. */
        discardKey: () => attempt.settle(),
    };
}

export interface SaleOutcome {
    /** The recorded sale, as the server stored it. */
    receipt: Receipt;
    /**
     * True when this ticket had already been recorded by an earlier try
     * with a different payment: `receipt` holds the original payment.
     */
    alreadyRecorded: boolean;
}

/** A replayed sale that was voided or refunded after it was recorded. */
export class SaleNotCompletedError extends Error {
    constructor(readonly receipt: Receipt) {
        const what =
            receipt.status === SaleStatus.REFUNDED ? 'refunded' : 'voided';
        super(
            `This ticket was already recorded as a sale that has since been ${what}, so nothing was charged. Confirm again to ring it up as a new sale.`,
        );
        this.name = 'SaleNotCompletedError';
    }
}

/**
 * The stored receipt a 409 SALE_003 carries when this cashier's ticket was
 * already recorded with a different payment, or null for any other error.
 */
function recordedReceipt(error: unknown): Receipt | null {
    const body = apiErrorBody(error);
    if (body?.error !== ErrorCode.SALE_IDEMPOTENCY_MISMATCH) return null;
    const details = body.details as { receipt?: Receipt } | null;
    const receipt = details?.receipt;
    return receipt && typeof receipt._id === 'string' ? receipt : null;
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

    const data = res.data as Partial<AppErrorResponse> | undefined;
    const message =
        typeof data?.message === 'string' && data.message
            ? data.message.replace(/\.$/, '')
            : 'Sale failed';

    const code = apiErrorCode(error);
    if (code === ErrorCode.SALE_IN_PROGRESS) return `${message}.`;
    if (code === ErrorCode.SHIFT_NOT_OPEN) {
        return 'Your shift is no longer open, so nothing was charged. Open a shift to continue; the ticket is kept.';
    }
    if (code === ErrorCode.SALE_IDEMPOTENCY_MISMATCH) {
        return `${message}. Check Sales History before charging again.`;
    }
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
