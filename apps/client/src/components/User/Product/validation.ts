import {
    barcodeFieldError,
    fieldErrors,
    moneyError,
    productNameError,
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
        name: productNameError(form.name),
        price: moneyError(form.price),
    });
}
