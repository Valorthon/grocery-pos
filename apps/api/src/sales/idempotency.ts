import { createHash } from 'node:crypto';
import { SellDto } from './types';

/** Mongo's duplicate-key error on `field`, as thrown by a unique index. */
export function isDuplicateKey(err: unknown, field: string): boolean {
    const e = err as { code?: unknown; keyPattern?: Record<string, unknown> };
    return Number(e?.code) === 11000 && !!e.keyPattern && field in e.keyPattern;
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Fingerprint of a `POST /sales` request, stored on the sale as
 * `requestHash`. A request that reuses an idempotency key must hash the
 * same as the one that recorded the sale, or it is refused as a different
 * sale.
 *
 * A hash of the normalized request is used rather than comparing it with
 * the stored sale: the sale keeps what the server derived (prices, change,
 * discount amount), not what was asked, so the two cannot be compared
 * field by field.
 *
 * Normalized means only what decides the sale is hashed, in a fixed order:
 * the cashier, payment type, GCash reference, tenders (by type), lines (by
 * product, then quantity) and the requested discount. The key itself is
 * not part of it.
 */
export function saleRequestHash(cashier: string, dto: SellDto): string {
    const canonical = {
        cashier,
        paymentType: dto.paymentType,
        referenceNumber: dto.referenceNumber ?? null,
        tenders: dto.tenders
            .map(({ type, amount }) => ({ type: String(type), amount }))
            .sort((a, b) => byString(a.type, b.type) || a.amount - b.amount),
        sellDetails: dto.sellDetails
            .map(({ product, quantity }) => ({
                product: String(product),
                quantity,
            }))
            .sort(
                (a, b) =>
                    byString(a.product, b.product) || a.quantity - b.quantity,
            ),
        discount: dto.discount
            ? {
                  type: dto.discount.type,
                  value: dto.discount.value,
                  reason: dto.discount.reason,
              }
            : null,
    };

    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
