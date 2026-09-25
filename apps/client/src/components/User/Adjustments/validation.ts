import { STRING_LIMITS } from '@grocery-pos/contracts';
import {
    fieldErrors,
    integerError,
    productPickError,
    textError,
} from '@/utils/rules';
import type { AddFormInput, SaveForm } from './dto';

type Errors = Record<string, string>;

/**
 * Why an adjustment line would be refused (`AdjustFields`), by field; empty
 * when it is accepted. The product is the picked id, never the typed search
 * text; the change is a non-zero whole number and may be negative (a
 * write-off); the reason is required.
 */
export function adjustmentLineErrors(form: AddFormInput): Errors {
    return fieldErrors({
        EAN: productPickError(form.product),
        change: integerError(form.change, { nonZero: true }),
        reason: textError(form.reason, STRING_LIMITS.REASON),
    });
}

/** Why an adjustment's description would be refused (`AdjustDto`). */
export function adjustmentSaveErrors(form: SaveForm): Errors {
    return fieldErrors({
        description: textError(form.description, STRING_LIMITS.DESCRIPTION),
    });
}
