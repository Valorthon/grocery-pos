import { NUMERIC_LIMITS, STRING_LIMITS } from '@grocery-pos/contracts';
import {
    barcodeFieldError,
    fieldErrors,
    integerError,
    moneyError,
    productPickError,
    textError,
} from '@/utils/rules';
import type { AddFormInput, SaveForm } from './dto';

type Errors = Record<string, string>;

/**
 * Why a restock line would be refused (`RestockFields`), by field; empty
 * when it is accepted. An existing-product line needs a picked product id,
 * never just typed search text; a new product needs its name, price and a
 * valid (or auto-generated) barcode.
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
        unitCost: moneyError(form.unitCost),
    });
}

/** Why a restock's description would be refused (`RestockDto`). */
export function restockSaveErrors(form: SaveForm): Errors {
    return fieldErrors({
        description: textError(form.description, STRING_LIMITS.DESCRIPTION),
    });
}
