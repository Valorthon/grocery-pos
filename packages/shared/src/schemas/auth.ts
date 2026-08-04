import * as z from 'zod';
import { STRING_LIMITS } from '../constants.js';

export const loginSchema = z.object({
    username: z.string().trim().toLowerCase().max(STRING_LIMITS.USERNAME),
    password: z.string().max(STRING_LIMITS.PASSWORD),
});

export type LoginDto = z.infer<typeof loginSchema>;
