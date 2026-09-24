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

export interface SaveForm {
    description: string;
}

export interface MatchedProductsDto {
    EAN: string;
    name: string;
    product: string;
}
