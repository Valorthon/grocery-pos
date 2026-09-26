interface AddFormFields {
    autoGenerateEAN: boolean;
    EAN: string;
    quantity: number;
    /** Centavos. */
    unitCost: number;
    /** Centavos. */
    totalCost?: number;
    name: string;
}

/**
 * A restock line as the add dialog emits it: a new product with its price,
 * or an existing product with its id, never both.
 */
export type AddForm = AddFormFields &
    (
        | {
              isNewProduct: true;
              /** Centavos. */
              price: number;
              product?: undefined;
          }
        | { isNewProduct: false; product: string; price?: undefined }
    );

/**
 * The add dialog's form state: unitCost and price hold the pesos as typed
 * text and become centavos in AddForm on submit; quantity is a number, or
 * '' while blank (`v-model.number`). Validated by `restockLineErrors`.
 */
export interface AddFormInput extends Omit<
    AddFormFields,
    'quantity' | 'unitCost' | 'totalCost'
> {
    isNewProduct: boolean;
    product?: string;
    quantity: number | string;
    unitCost: string;
    price: string;
}

export interface SaveForm {
    description: string;
}
