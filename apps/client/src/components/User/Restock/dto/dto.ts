export interface AddForm {
    autoGenerateEAN: boolean;
    EAN: string;
    quantity: number;
    unitCost: number;
    totalCost?: number;
    product?: string;

    isNewProduct: boolean;
    name: string;
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
