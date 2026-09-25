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
 * text and become centavos in AddForm on submit; quantity is a number, or
 * '' while blank (`v-model.number`). Validated by `restockLineErrors`.
 */
export interface AddFormInput extends Omit<
    AddForm,
    'quantity' | 'unitCost' | 'totalCost' | 'price'
> {
    quantity: number | string;
    unitCost: string;
    price: string;
}

export interface SaveForm {
    description: string;
}
