import { STRING_LIMITS, normalizeProductName } from '@grocery-pos/contracts';
import {
    barcodeFieldError,
    fieldErrors,
    moneyError,
    textError,
} from '@/utils/rules';

/** The product dialog's form state; `price` is the pesos as typed. */
export interface ProductFormInput {
    tracksExpiry?: boolean;
    unit?: import('@grocery-pos/contracts').UnitOfMeasure;
    category?: string;
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
        // Measured as stored (#443), as the DTO does.
        name: textError(
            normalizeProductName(form.name),
            STRING_LIMITS.PRODUCT_NAME,
        ),
        price: moneyError(form.price),
    });
}
