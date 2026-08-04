import * as z from 'zod';
import { STRING_LIMITS } from '../constants';

export const inventoryGetAllSchema = z.object({
    maxStock: z.coerce.number().optional(),
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

export type InventoryGetAllDto = z.infer<typeof inventoryGetAllSchema>;
