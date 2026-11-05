import { NUMERIC_LIMITS } from '@grocery-pos/contracts';
import { InternalError } from '../common/errors';

/** Legacy absence is unknown, never a free receipt. Only explicit integer zero is free. */
export function receiptCost(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > NUMERIC_LIMITS.AMOUNT_MAX
    )
        throw new InternalError('Invalid stored receipt cost');
    return value;
}
