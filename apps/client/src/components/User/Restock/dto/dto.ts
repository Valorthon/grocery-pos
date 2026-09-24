export interface AddForm {
    autoGenerateEAN: boolean;
    EAN: string;
    quantity: number;
    /** Centavos. */
    unitCost: number;
    /** Centavos. */
    totalCost?: number;
    product?: string;

    isNewProduct: boolean;
    name: string;
    /** Centavos. */
    price?: number;
}

/**
 * The add dialog's form state: unitCost and price hold the pesos as typed
 * (a number, or '' while blank) and become centavos in AddForm on submit.
 */
export interface AddFormInput extends Omit<
    AddForm,
    'unitCost' | 'totalCost' | 'price'
> {
    unitCost: number | string;
    price: number | string;
}

export interface SaveForm {
    description: string;
}

export interface MatchedProductsDto {
    EAN: string;
    name: string;
    product: string;
}
