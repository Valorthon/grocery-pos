import * as z from 'zod';
import { NUMERIC_LIMITS, STRING_LIMITS } from '../constants.js';
import { Category } from '../enums.js';

export const ensureValidSchema = z.object({
    EAN: z.string().trim().max(STRING_LIMITS.EAN).optional(),
    name: z
        .string()
        .trim()
        .toLowerCase()
        .max(STRING_LIMITS.PRODUCT_NAME)
        .optional(),
    autoGenerateEAN: z.coerce.boolean().optional(),
});

export const newProductFieldsSchema = z.object({
    EAN: z.string().trim().max(STRING_LIMITS.EAN).optional(),
    name: z.string().trim().toLowerCase().max(STRING_LIMITS.PRODUCT_NAME),
    category: z.nativeEnum(Category).optional(),
    price: z.coerce.number().min(NUMERIC_LIMITS.PRICE_MIN),
});

export const newProductsSchema = z.object({
    newProducts: z.array(newProductFieldsSchema).min(1),
});

export const productGetSchema = z.object({
    EAN: z.string().trim().max(STRING_LIMITS.EAN),
});

export const productMatchesSchema = z.object({
    EAN: z.string().trim().max(STRING_LIMITS.EAN).optional(),
    name: z
        .string()
        .trim()
        .toLowerCase()
        .max(STRING_LIMITS.PRODUCT_NAME)
        .optional(),
});

export const productGetAllSchema = z.object({
    name: z
        .string()
        .trim()
        .toLowerCase()
        .max(STRING_LIMITS.PRODUCT_NAME)
        .optional(),
    EAN: z.string().trim().max(STRING_LIMITS.EAN).optional(),
    page: z.coerce.number().positive(),
    limit: z.coerce.number().positive(),
});

const productUpdateFieldsSchema = z.object({
    name: z
        .string()
        .trim()
        .toLowerCase()
        .max(STRING_LIMITS.PRODUCT_NAME)
        .optional(),
    price: z.coerce.number().min(NUMERIC_LIMITS.PRICE_MIN).optional(),
});

const productUpdateBulkFieldsSchema = z.object({
    product: z.string(),
    update: productUpdateFieldsSchema,
});

export const productUpdateBulkSchema = z.object({
    updates: z.array(productUpdateBulkFieldsSchema).min(1),
});

export type EnsureValidDto = z.infer<typeof ensureValidSchema>;
export type NewProductFields = z.infer<typeof newProductFieldsSchema>;
export type NewProductsDto = z.infer<typeof newProductsSchema>;
export type ProductGetDto = z.infer<typeof productGetSchema>;
export type ProductMatchesDto = z.infer<typeof productMatchesSchema>;
export type ProductGetAllDto = z.infer<typeof productGetAllSchema>;
export type ProductUpdateFields = z.infer<typeof productUpdateFieldsSchema>;
export type ProductUpdateBulkFields = z.infer<
    typeof productUpdateBulkFieldsSchema
>;
export type ProductUpdateBulkDto = z.infer<typeof productUpdateBulkSchema>;
