import { parseClientEnv } from '@/config/validation.env';

const parsedEnv = parseClientEnv(import.meta.env);

if (!parsedEnv.success) {
    throw new Error('Env validation failed');
}

export const env = parsedEnv.data;
