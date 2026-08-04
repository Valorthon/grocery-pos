import * as z from 'zod';
import { STRING_LIMITS, VALIDATION } from '../constants.js';

export const adjustmentGetDetailsParamSchema = z.object({
    adjustment: z.string(),
});

export const adjustmentGetDetailsQuerySchema = z.object({
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

export const adjustFieldsSchema = z.object({
    product: z.string(),
    change: z.coerce
        .number()
        .refine((val) => val !== VALIDATION.CHANGE_NOT_ZERO, {
            message: 'Change must not be 0',
        }),
    reason: z.string().trim().max(STRING_LIMITS.REASON).optional(),
});

export const adjustSchema = z.object({
    description: z.string().trim().max(STRING_LIMITS.DESCRIPTION),
    adjustDetails: z.array(adjustFieldsSchema).min(1),
});

export const adjustmentGetAllSchema = z.object({
    adjustedBy: z.string().optional(),
    dateRange: z.array(z.coerce.date()).optional(),
    page: z.coerce.number().positive(),
    limit: z.coerce.number().positive(),
});

export type AdjustmentGetDetailsParamDto = z.infer<
    typeof adjustmentGetDetailsParamSchema
>;
export type AdjustmentGetDetailsQueryDto = z.infer<
    typeof adjustmentGetDetailsQuerySchema
>;
export type AdjustmentGetDetailsDto = AdjustmentGetDetailsParamDto &
    AdjustmentGetDetailsQueryDto;
export type AdjustFields = z.infer<typeof adjustFieldsSchema>;
export type AdjustDto = z.infer<typeof adjustSchema>;
export type AdjustmentGetAllDto = z.infer<typeof adjustmentGetAllSchema>;
