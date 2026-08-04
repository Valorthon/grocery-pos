import type { ProductMatchesDto } from '@grocery-pos/shared';

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

export type MatchedProductsDto = ProductMatchesDto;
