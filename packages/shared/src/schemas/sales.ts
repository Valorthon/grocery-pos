import * as z from 'zod';
import { NUMERIC_LIMITS, STRING_LIMITS } from '../constants.js';
import { PaymentType } from '../enums.js';

export const salesGetDetailsSchema = z.object({
    sale: z.string(),
});

export const sellDetailsFieldsSchema = z.object({
    product: z.string(),
    quantity: z.coerce.number().int().min(NUMERIC_LIMITS.QUANTITY_MIN),
});

export const sellSchema = z.object({
    paymentType: z.nativeEnum(PaymentType),
    referenceNumber: z.string().max(STRING_LIMITS.REFERENCE_NUMBER).optional(),
    sellDetails: z.array(sellDetailsFieldsSchema).min(1),
});

export const salesGetAllSchema = z.object({
    page: z.coerce.number().positive(),
    limit: z.coerce.number().positive(),
});

export const receiptFieldsSchema = z.object({
    productName: z.string(),
    quantity: z.number(),
    amount: z.number(),
});

export const receiptSchema = z.object({
    cashierName: z.string(),
    items: z.array(receiptFieldsSchema),
    totalAmount: z.number(),
});

export type SalesGetDetailsDto = z.infer<typeof salesGetDetailsSchema>;
export type SellDetailsFields = z.infer<typeof sellDetailsFieldsSchema>;
export type SellDto = z.infer<typeof sellSchema>;
export type SalesGetAllDto = z.infer<typeof salesGetAllSchema>;
export type ReceiptFields = z.infer<typeof receiptFieldsSchema>;
export type ReceiptDto = z.infer<typeof receiptSchema>;
