import { NUMERIC_LIMITS, STRING_LIMITS } from '@grocery-pos/contracts';
import type { ConfirmRequest } from '@/composables/useConfirm';
import { countOf } from '@/utils/plural';
import {
    barcodeFieldError,
    fieldErrors,
    integerError,
    moneyError,
    productPickError,
    textError,
} from '@/utils/rules';
import type { AddForm, AddFormInput, SaveForm } from './dto';

type Errors = Record<string, string>;

/**
 * Why a restock line would be refused (`RestockFields`), by field; empty
 * when it is accepted. An existing-product line needs a picked product id,
 * never just typed search text; a new product needs its name, price and a
 * valid (or auto-generated) barcode. The unit cost may be ₱0, never
 * negative (#85).
 */
export function restockLineErrors(form: AddFormInput): Errors {
    return fieldErrors({
        EAN: form.isNewProduct
            ? barcodeFieldError(form.EAN, form.autoGenerateEAN)
            : productPickError(form.product),
        name: form.isNewProduct
            ? textError(form.name, STRING_LIMITS.PRODUCT_NAME)
            : '',
        price: form.isNewProduct ? moneyError(form.price) : '',
        quantity: integerError(form.quantity, {
            min: NUMERIC_LIMITS.QUANTITY_MIN,
        }),
        // ₱0 passes here; the page asks "Record at ₱0 cost?" on save (#85).
        unitCost: moneyError(form.unitCost, NUMERIC_LIMITS.UNIT_COST_MIN),
    });
}

/** Why a restock's description would be refused (`RestockDto`). */
export function restockSaveErrors(form: SaveForm): Errors {
    return fieldErrors({
        description: textError(form.description, STRING_LIMITS.DESCRIPTION),
    });
}

/** How many ₱0 lines the question names before "and N more". */
export const ZERO_COST_NAMED = 5;

/**
 * The question asked on save when lines have a ₱0 unit cost (#85), naming
 * them; null when none has. The API accepts ₱0, so this is the one check
 * that a free line is meant.
 */
export function zeroCostRequest(
    lines: Pick<AddForm, 'unitCost' | 'name' | 'EAN'>[],
): ConfirmRequest | null {
    const free = lines
        .filter((line) => line.unitCost === 0)
        .map((line) => line.name.trim() || line.EAN);
    if (free.length === 0) return null;
    const one = free.length === 1;
    const named = free.slice(0, ZERO_COST_NAMED).join(', ');
    const more = free.length - ZERO_COST_NAMED;
    const list = more > 0 ? `${named} and ${more} more` : named;
    return {
        title: 'Record at ₱0 cost?',
        message: `${countOf(free.length, 'line')} ${one ? 'has' : 'have'} a ₱0 unit cost: ${list}. Record ${one ? 'it' : 'them'} at ₱0 cost?`,
        confirmLabel: 'Record at ₱0',
        cancelLabel: 'Go back',
    };
}
