import * as z from 'zod';
import { STRING_LIMITS } from '../constants.js';
import { Role } from '../enums.js';

const createFieldsSchema = z.object({
    name: z.string().trim().toLowerCase().max(STRING_LIMITS.USERNAME),
    password: z.string().max(STRING_LIMITS.PASSWORD),
    roles: z.array(z.nativeEnum(Role)).min(1),
});

export const createBulkSchema = z.object({
    users: z.array(createFieldsSchema).min(1),
});

const updateFieldsSchema = z.object({
    name: z
        .string()
        .trim()
        .toLowerCase()
        .max(STRING_LIMITS.USERNAME)
        .optional(),
    password: z.string().max(STRING_LIMITS.PASSWORD).optional(),
    roles: z.array(z.nativeEnum(Role)).optional(),
    isActive: z.boolean().optional(),
});

const updateBulkFieldsSchema = z.object({
    user: z.string(),
    update: updateFieldsSchema,
});

export const updateBulkSchema = z.object({
    updates: z.array(updateBulkFieldsSchema).min(1),
});

export const userGetAllSchema = z.object({
    name: z
        .string()
        .trim()
        .toLowerCase()
        .max(STRING_LIMITS.USERNAME)
        .optional(),
    page: z.coerce.number().positive(),
    limit: z.coerce.number().positive(),
});

export type CreateFields = z.infer<typeof createFieldsSchema>;
export type CreateBulkDto = z.infer<typeof createBulkSchema>;
export type UpdateFields = z.infer<typeof updateFieldsSchema>;
export type UpdateBulkFields = z.infer<typeof updateBulkFieldsSchema>;
export type UpdateBulkDto = z.infer<typeof updateBulkSchema>;
export type UserGetAllDto = z.infer<typeof userGetAllSchema>;
