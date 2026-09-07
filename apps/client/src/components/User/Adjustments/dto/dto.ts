export interface SaveForm {
    description: string;
}

export interface AddForm {
    EAN: string;
    name: string;
    change: number;
    reason: string;
    product: string;
}

export interface MatchedProductsDto {
    EAN: string;
    name: string;
    product: string;
}
