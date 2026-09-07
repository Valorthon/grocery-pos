import { envSchema } from '@/config/validation.env';

const parsedEnv = envSchema.safeParse(import.meta.env);

if (!parsedEnv.success) {
    throw new Error('Env validation failed');
}

export const env = parsedEnv.data;
