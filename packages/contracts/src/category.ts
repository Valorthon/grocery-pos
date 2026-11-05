import type { WireShape } from './wire-shape.js';

export const CATEGORY_NAME_MAX = 60;
export const CATEGORY_SORT_MAX = 1000000;
export interface CategoryDto {
    _id: string;
    name: string;
    isActive: boolean;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
}
export const CATEGORY_SHAPE: WireShape<CategoryDto> = {
    _id: 'required',
    name: 'required',
    isActive: 'required',
    sortOrder: 'required',
    createdAt: 'required',
    updatedAt: 'required',
};
export interface CreateCategoryRequest {
    name: string;
    sortOrder?: number;
}
export interface UpdateCategoryRequest {
    name?: string;
    isActive?: boolean;
    sortOrder?: number;
}
/** Migration labels only, not a selectable category enum. */
export const LEGACY_CATEGORY_NAMES = [
    'FOOD',
    'DRINKS',
    'ELECTRONICS',
    'HOUSEHOLD',
    'CLOTHES',
] as const;
