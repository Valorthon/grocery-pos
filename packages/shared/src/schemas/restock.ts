import * as z from 'zod';
import { NUMERIC_LIMITS, STRING_LIMITS } from '../constants';
import { newProductFieldsSchema } from './product';

export const restockGetDetailsParamSchema = z.object({
    restock: z.string(),
});

export const restockGetDetailsQuerySchema = z.object({
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

export const restockFieldsSchema = z.object({
    newProduct: newProductFieldsSchema.optional(),
    product: z.string().optional(),
    quantity: z.coerce.number().int().min(NUMERIC_LIMITS.QUANTITY_MIN),
    unitCost: z.coerce.number().min(NUMERIC_LIMITS.PRICE_MIN),
});

export const restockSchema = z.object({
    restockDetails: z.array(restockFieldsSchema).min(1),
    description: z.string().trim().max(STRING_LIMITS.DESCRIPTION),
});

export const restockGetAllSchema = z.object({
    restockedBy: z.string().optional(),
    dateRange: z.array(z.coerce.date()).optional(),
    page: z.coerce.number().positive(),
    limit: z.coerce.number().positive(),
});

export type RestockGetDetailsParamDto = z.infer<typeof restockGetDetailsParamSchema>;
export type RestockGetDetailsQueryDto = z.infer<typeof restockGetDetailsQuerySchema>;
export type RestockGetDetailsDto = RestockGetDetailsParamDto &
    RestockGetDetailsQueryDto;
export type RestockFields = z.infer<typeof restockFieldsSchema>;
export type RestockDto = z.infer<typeof restockSchema>;
export type RestockGetAllDto = z.infer<typeof restockGetAllSchema>;
