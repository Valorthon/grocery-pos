import { STRING_LIMITS } from '@grocery-pos/contracts';
import {
    barcodeFieldError,
    fieldErrors,
    moneyError,
    textError,
} from '@/utils/rules';

/** The product dialog's form state; `price` is the pesos as typed. */
export interface ProductFormInput {
    EAN: string;
    name: string;
    price: string;
    autoGenerateEAN: boolean;
}

/**
 * Why a new product would be refused (`NewProductFields`), by field; empty
 * when it is accepted.
 */
export function productErrors(form: ProductFormInput): Record<string, string> {
    return fieldErrors({
        EAN: barcodeFieldError(form.EAN, form.autoGenerateEAN),
        name: textError(form.name, STRING_LIMITS.PRODUCT_NAME),
        price: moneyError(form.price),
    });
}
